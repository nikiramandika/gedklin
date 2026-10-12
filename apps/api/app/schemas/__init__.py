from __future__ import annotations

from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    CatalogGroup,
    CatalogUnit,
    NotificationStatus,
    NotificationType,
    OrderStatus,
    Process,
    Role,
)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth & user -----------------------------------------------------------


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


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.]+$")
    password: str = Field(min_length=8)
    role: Role


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


# --- Katalog, pengaturan, operasional --------------------------------------


class CatalogItemOut(ORM):
    code: str
    name: str
    group: CatalogGroup
    process: Process
    unit: CatalogUnit
    price: int
    extra_price: int | None
    min_qty: float | None
    kg_per_load: float | None
    pcs_per_load: int | None
    max_extra: float | None
    sort_order: int
    is_active: bool


class CatalogItemUpdate(BaseModel):
    """Field yang dikirim saja yang diubah; kirim null untuk mengosongkan aturan."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    price: int | None = Field(default=None, ge=0)
    extra_price: int | None = Field(default=None, ge=0)
    min_qty: float | None = Field(default=None, ge=0)
    kg_per_load: float | None = Field(default=None, gt=0)
    pcs_per_load: int | None = Field(default=None, gt=0)
    max_extra: float | None = Field(default=None, ge=0)
    is_active: bool | None = None


class AppSettingsOut(BaseModel):
    express_multiplier: float
    default_promise_hours: float
    default_staff_on_duty: int
    default_washers_available: int
    default_dryers_available: int
    default_open_time: time
    default_close_time: time


class AppSettingsIn(BaseModel):
    express_multiplier: float | None = Field(default=None, ge=1, le=10)
    default_promise_hours: float | None = Field(default=None, gt=0, le=24 * 14)
    default_staff_on_duty: int | None = Field(default=None, ge=0, le=50)
    default_washers_available: int | None = Field(default=None, ge=0, le=50)
    default_dryers_available: int | None = Field(default=None, ge=0, le=50)
    default_open_time: time | None = None
    default_close_time: time | None = None


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


# --- Pesanan ---------------------------------------------------------------


class CustomerOut(ORM):
    id: int
    name: str
    phone_wa: str


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


class OrderItemOut(ORM):
    catalog_code: str
    name: str
    group: CatalogGroup
    process: Process
    weight_kg: float | None
    qty_pcs: int | None
    loads: int | None
    extra_kg: int | None
    extra_pcs: int | None
    subtotal: int


class QuoteOut(BaseModel):
    is_express: bool
    express_multiplier: float
    items: list[OrderItemOut]
    total: int


class StatusChange(BaseModel):
    to_status: OrderStatus


class StatusHistoryOut(ORM):
    from_status: OrderStatus | None
    to_status: OrderStatus
    changed_at: datetime


class OrderOut(ORM):
    id: int
    tracking_code: str
    customer: CustomerOut
    is_express: bool
    items: list[OrderItemOut]
    price_total: int
    status: OrderStatus
    received_at: datetime
    promised_ready_at: datetime | None
    predicted_ready_at: datetime | None
    ready_at: datetime | None
    picked_up_at: datetime | None
    delay_notif_count: int
    ready_notif_sent: bool
    needs_followup: bool
    next_status: OrderStatus | None = None
    queue_position: int | None = None


class OrderDetailOut(OrderOut):
    history: list[StatusHistoryOut]


class ReceiptOut(BaseModel):
    order: OrderOut
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


# --- Publik (tanpa data pribadi) -------------------------------------------


class TrackingItemOut(ORM):
    name: str
    weight_kg: float | None
    qty_pcs: int | None


class TrackingOut(BaseModel):
    tracking_code: str
    is_express: bool
    items: list[TrackingItemOut]
    status: OrderStatus
    received_at: datetime
    promised_ready_at: datetime | None
    predicted_ready_at: datetime | None
    ready_at: datetime | None
    picked_up_at: datetime | None
    history: list[StatusHistoryOut]


# --- Dasbor ----------------------------------------------------------------


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
    # Akurasi 7 hari terakhir pada pesanan yang sudah READY, dalam jam.
    eta_mae_hours_7d: float | None
    eta_within_tolerance_pct_7d: float | None
    promise_mae_hours_7d: float | None
    eta_samples_7d: int
    eta_tolerance_hours: float
    model_version: str
    last_7_days: list[DailyCount]
    status_counts: dict[str, int]
