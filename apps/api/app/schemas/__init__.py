from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import (
    CatalogGroup,
    CatalogUnit,
    NotificationStatus,
    NotificationType,
    OrderStatus,
    PaymentMethod,
    Process,
    Role,
)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(ORM):
    id: int
    name: str
    username: str
    role: Role
    is_active: bool


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# Akun pemilik hanya dibuat lewat seed; dari aplikasi pemilik menambah atau mengubah akun staff.
StaffRole = Literal[Role.CASHIER, Role.STAFF]


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.]+$")
    password: str = Field(min_length=8)
    role: StaffRole


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: StaffRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class CatalogItemOut(ORM):
    code: str
    name: str
    group: CatalogGroup
    process: Process
    unit: CatalogUnit
    price: int | None
    extra_price: int | None
    base_kg: float | None
    min_qty: float | None
    kg_per_load: float | None
    pcs_per_load: int | None
    max_extra: float | None
    express_eligible: bool
    sort_order: int
    is_active: bool


class CatalogItemCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Z0-9_]+$")
    name: str = Field(min_length=1, max_length=100)
    group: CatalogGroup
    process: Process
    unit: CatalogUnit
    # null = harga belum diketahui; layanan harus nonaktif.
    price: int | None = Field(default=None, ge=0)
    extra_price: int | None = Field(default=None, ge=0)
    base_kg: float | None = Field(default=None, gt=0)
    min_qty: float | None = Field(default=None, ge=0)
    kg_per_load: float | None = Field(default=None, gt=0)
    pcs_per_load: int | None = Field(default=None, gt=0)
    max_extra: float | None = Field(default=None, ge=0)
    express_eligible: bool = False
    is_active: bool = True


class CatalogItemUpdate(BaseModel):
    """Field yang dikirim saja yang diubah; kirim null untuk mengosongkan aturan.

    Kode tidak bisa diubah karena dirujuk item pesanan lama.
    """

    name: str | None = Field(default=None, min_length=1, max_length=100)
    group: CatalogGroup | None = None
    process: Process | None = None
    unit: CatalogUnit | None = None
    price: int | None = Field(default=None, ge=0)
    extra_price: int | None = Field(default=None, ge=0)
    base_kg: float | None = Field(default=None, gt=0)
    min_qty: float | None = Field(default=None, ge=0)
    kg_per_load: float | None = Field(default=None, gt=0)
    pcs_per_load: int | None = Field(default=None, gt=0)
    max_extra: float | None = Field(default=None, ge=0)
    express_eligible: bool | None = None
    is_active: bool | None = None


class AppSettingsOut(BaseModel):
    express_multiplier: float
    machine_capacity_kg: float
    default_promise_hours: float
    default_staff_on_duty: int
    default_washers_available: int
    default_dryers_available: int
    default_open_time: time
    default_close_time: time
    closed_weekdays: list[int]
    outlet_name: str
    outlet_address: str
    outlet_phone: str
    wash_minutes_per_load: float
    dry_minutes_per_load: float
    iron_minutes_per_kg: float
    iron_minutes_per_pcs: float


class AppSettingsIn(BaseModel):
    express_multiplier: float | None = Field(default=None, ge=1, le=10)
    machine_capacity_kg: float | None = Field(default=None, gt=0, le=50)
    default_promise_hours: float | None = Field(default=None, gt=0, le=24 * 14)
    default_staff_on_duty: int | None = Field(default=None, ge=0, le=50)
    default_washers_available: int | None = Field(default=None, ge=0, le=50)
    default_dryers_available: int | None = Field(default=None, ge=0, le=50)
    default_open_time: time | None = None
    default_close_time: time | None = None
    # 0 = Senin ... 6 = Minggu.
    closed_weekdays: list[Annotated[int, Field(ge=0, le=6)]] | None = Field(
        default=None, max_length=7
    )
    outlet_name: str | None = Field(default=None, min_length=1, max_length=60)
    outlet_address: str | None = Field(default=None, max_length=200)
    outlet_phone: str | None = Field(default=None, max_length=30)
    wash_minutes_per_load: float | None = Field(default=None, gt=0, le=600)
    dry_minutes_per_load: float | None = Field(default=None, ge=0, le=600)
    iron_minutes_per_kg: float | None = Field(default=None, ge=0, le=120)
    iron_minutes_per_pcs: float | None = Field(default=None, ge=0, le=120)

    # Dirapikan sebelum dicek panjangnya, supaya nama berisi spasi saja ditolak.
    @field_validator("outlet_name", "outlet_address", "outlet_phone", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class OutletOut(BaseModel):
    name: str
    address: str
    phone: str


class ServicePromiseOut(ORM):
    process: Process
    regular_hours: int | None
    express_hours: int | None
    min_regular_hours: int | None


class ServicePromiseIn(BaseModel):
    regular_hours: int | None = Field(default=None, gt=0, le=24 * 14)
    express_hours: int | None = Field(default=None, gt=0, le=24 * 14)
    min_regular_hours: int | None = Field(default=None, gt=0, le=24 * 14)


class DailyOperationIn(BaseModel):
    is_open: bool = True
    staff_on_duty: int = Field(ge=0, le=50)
    washers_available: int = Field(ge=0, le=50)
    dryers_available: int = Field(ge=0, le=50)
    open_time: time
    close_time: time
    machine_issue_note: str | None = None


class DailyOperationOut(ORM):
    date: date
    is_open: bool
    staff_on_duty: int
    washers_available: int
    dryers_available: int
    open_time: time
    close_time: time
    machine_issue_note: str | None


class CustomerOut(ORM):
    id: int
    name: str
    phone_wa: str
    has_whatsapp: bool


class OrderItemIn(BaseModel):
    catalog_code: str = Field(min_length=1, max_length=40)
    weight_kg: float | None = Field(default=None, gt=0, le=200)
    # Untuk item per kg dengan tambahan pcs (mis. sprei kecil) boleh 0.
    qty_pcs: int | None = Field(default=None, ge=0, le=500)


class QuoteIn(BaseModel):
    is_express: bool = False
    items: list[OrderItemIn] = Field(min_length=1, max_length=30)


class OrderCreate(QuoteIn):
    customer_name: str = Field(min_length=1, max_length=100)
    customer_phone: str = Field(min_length=8, max_length=20)
    customer_has_whatsapp: bool = True
    notes: str | None = Field(default=None, max_length=1000)
    payment_method: PaymentMethod | None = None


class OrderDetailsUpdate(BaseModel):
    """Field yang dikirim saja yang diubah; kirim null/"" untuk mengosongkan."""

    notes: str | None = Field(default=None, max_length=1000)
    rack_location: str | None = Field(default=None, max_length=20)


class PaymentIn(BaseModel):
    method: PaymentMethod


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


class OrderItemOut(ORM):
    catalog_code: str
    name: str
    group: CatalogGroup
    process: Process
    weight_kg: float | None
    qty_pcs: int | None
    machine_loads: int | None
    extra_kg: int | None
    extra_pcs: int | None
    is_express: bool
    subtotal: int


class QuoteOut(BaseModel):
    is_express: bool
    express_multiplier: float
    items: list[OrderItemOut]
    total: int


class StatusChange(BaseModel):
    to_status: OrderStatus
    rack_location: str | None = Field(default=None, max_length=20)
    payment_method: PaymentMethod | None = None


class PublicStatusHistoryOut(ORM):
    """Riwayat untuk portal publik: tanpa nama petugas."""

    from_status: OrderStatus | None
    to_status: OrderStatus
    changed_at: datetime


class StatusHistoryOut(PublicStatusHistoryOut):
    changed_by_name: str | None = None


class OrderOut(ORM):
    id: int
    tracking_code: str
    customer: CustomerOut
    is_express: bool
    items: list[OrderItemOut]
    price_total: int
    created_by_name: str | None = None
    notes: str | None = None
    rack_location: str | None = None
    is_paid: bool = False
    payment_method: PaymentMethod | None = None
    paid_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    status: OrderStatus
    received_at: datetime
    promised_ready_at: datetime | None
    ready_at: datetime | None
    picked_up_at: datetime | None
    ready_notif_sent: bool
    needs_followup: bool
    next_status: OrderStatus | None = None
    queue_position: int | None = None
    # Hanya di antrean (LST): taksiran waktu proses dan kelonggaran sampai janji, jam kerja.
    processing_hours: float | None = None
    slack_hours: float | None = None


class OrderDetailOut(OrderOut):
    history: list[StatusHistoryOut]


class WorkItemOut(ORM):
    name: str
    process: Process
    weight_kg: float | None
    qty_pcs: int | None
    machine_loads: int | None


class WorkOrderOut(BaseModel):
    """Pesanan untuk layar Antrean Cucian (role staff): tanpa harga, pembayaran, dan nomor HP."""

    id: int
    tracking_code: str
    customer_name: str
    is_express: bool
    items: list[WorkItemOut]
    notes: str | None
    rack_location: str | None
    status: OrderStatus
    received_at: datetime
    promised_ready_at: datetime | None
    queue_position: int
    next_status: OrderStatus | None
    processing_hours: float
    slack_hours: float | None


class WorkStatusIn(BaseModel):
    to_status: Literal[OrderStatus.PROCESSING, OrderStatus.READY]
    rack_location: str | None = Field(default=None, max_length=20)


class ReceiptOut(BaseModel):
    order: OrderOut
    outlet: OutletOut
    tracking_url: str
    whatsapp_link: str
    message: str


class NotificationOut(ORM):
    id: int
    type: NotificationType
    status: NotificationStatus
    sent_at: datetime | None
    error: str | None
    created_at: datetime


class TrackingItemOut(ORM):
    name: str
    weight_kg: float | None
    qty_pcs: int | None


class OutletHoursOut(BaseModel):
    is_open: bool
    open_time: time
    close_time: time


class TrackingOut(BaseModel):
    """Portal publik: tanpa nomor HP, nama petugas, atau catatan; nama pelanggan disamarkan."""

    tracking_code: str
    customer_name: str
    whatsapp_updates: bool
    is_express: bool
    items: list[TrackingItemOut]
    price_total: int
    is_paid: bool
    outlet: OutletOut
    outlet_today: OutletHoursOut
    status: OrderStatus
    received_at: datetime
    promised_ready_at: datetime | None
    ready_at: datetime | None
    picked_up_at: datetime | None
    history: list[PublicStatusHistoryOut]


class CustomerSummaryOut(BaseModel):
    id: int
    name: str
    phone_wa: str
    has_whatsapp: bool
    created_at: datetime
    order_count: int
    total_spent: int
    unpaid_total: int
    last_order_at: datetime | None


class CustomerDetailOut(CustomerSummaryOut):
    orders: list[OrderOut]


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    phone_wa: str | None = Field(default=None, min_length=8, max_length=20)
    has_whatsapp: bool | None = None


class ReportDay(BaseModel):
    date: date
    orders: int
    revenue: int


class ReportRow(BaseModel):
    key: str
    label: str
    orders: int
    revenue: int
    weight_kg: float = 0.0
    qty_pcs: int = 0


class ReportOut(BaseModel):
    start: date
    end: date
    orders: int
    revenue: int
    weight_kg: float
    avg_order_value: int
    paid_total: int
    unpaid_total: int
    unpaid_orders: int
    cancelled_orders: int
    express_orders: int
    by_day: list[ReportDay]
    by_service: list[ReportRow]
    by_cashier: list[ReportRow]
    by_payment: list[ReportRow]


class AiProviderOut(BaseModel):
    id: str
    label: str
    default_model: str


class AiSettingsOut(BaseModel):
    provider: str
    model: str
    has_key: bool
    key_hint: str | None
    providers: list[AiProviderOut]


class AiSettingsIn(BaseModel):
    provider: Literal["gemini", "openrouter"]
    model: str | None = Field(default=None, max_length=100)
    # Kosong = key lama dipertahankan.
    api_key: str | None = Field(default=None, max_length=500)
    clear_key: bool = False


class AiAnalysisIn(BaseModel):
    start: date | None = None
    end: date | None = None
    question: str | None = Field(default=None, max_length=500)


class AiAnalysisOut(ORM):
    id: int
    period_start: date
    period_end: date
    question: str | None
    text: str
    provider: str
    model: str
    created_by_name: str | None
    created_at: datetime


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class ActivityLogOut(ORM):
    id: int
    user_id: int | None
    user_name: str | None
    action: str
    entity_type: str
    entity_id: str | None
    summary: str
    changes: dict[str, list[Any]] | None
    created_at: datetime


class DailyCount(BaseModel):
    date: date
    orders: int
    revenue: int


class DashboardOut(BaseModel):
    today_orders: int
    today_revenue: int
    today_kg: float
    active_orders: int
    active_loads: int
    ready_not_picked: int
    needs_followup: int
    # Ketepatan janji 7 hari terakhir dari pesanan yang sudah siap.
    done_7d: int
    late_vs_promise_7d: int
    on_time_pct_7d: float | None
    avg_late_hours_7d: float | None
    overdue_active: int
    last_7_days: list[DailyCount]
    status_counts: dict[str, int]
