from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models import NotificationStatus, NotificationType, OrderStatus, Role, ServiceType


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


# --- Layanan & operasional -------------------------------------------------


class ServiceOut(ORM):
    code: ServiceType
    name: str
    price_per_kg_regular: Decimal
    price_per_kg_express: Decimal


class ServiceUpdate(BaseModel):
    name: str | None = None
    price_per_kg_regular: Decimal | None = Field(default=None, ge=0)
    price_per_kg_express: Decimal | None = Field(default=None, ge=0)


class DailyOperationIn(BaseModel):
    staff_on_duty: int = Field(ge=0, le=50)
    open_time: time
    close_time: time
    machine_issue_note: str | None = None


class DailyOperationOut(ORM):
    date: date
    staff_on_duty: int
    open_time: time
    close_time: time
    machine_issue_note: str | None


# --- Pesanan ---------------------------------------------------------------


class CustomerOut(ORM):
    id: int
    name: str
    phone_wa: str


class OrderCreate(BaseModel):
    customer_name: str = Field(min_length=1, max_length=100)
    customer_phone: str = Field(min_length=8, max_length=20)
    service_type: ServiceType
    is_express: bool = False
    weight_kg: float = Field(gt=0, le=100)


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
    service_type: ServiceType
    is_express: bool
    weight_kg: float
    price_total: Decimal
    status: OrderStatus
    received_at: datetime
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


class TrackingOut(BaseModel):
    tracking_code: str
    service_type: ServiceType
    is_express: bool
    weight_kg: float
    status: OrderStatus
    received_at: datetime
    predicted_ready_at: datetime | None
    ready_at: datetime | None
    picked_up_at: datetime | None
    history: list[StatusHistoryOut]


# --- Dasbor ----------------------------------------------------------------


class DailyCount(BaseModel):
    date: date
    orders: int
    revenue: Decimal


class DashboardOut(BaseModel):
    today_orders: int
    today_revenue: Decimal
    today_kg: float
    active_orders: int
    active_kg: float
    ready_not_picked: int
    needs_followup: int
    eta_mae_minutes_7d: float | None
    eta_samples_7d: int
    model_version: str
    last_7_days: list[DailyCount]
    status_counts: dict[str, int]
