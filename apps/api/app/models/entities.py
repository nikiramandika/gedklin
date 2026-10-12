from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, utcnow
from app.models.enums import (
    NotificationStatus,
    NotificationType,
    OrderStatus,
    Role,
    ServiceType,
)


def _enum(e: type) -> Enum:
    return Enum(e, name=e.__name__.lower(), values_callable=lambda x: [m.value for m in x])


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(_enum(Role))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    # Tidak pernah masuk dataset ML atau tampil di portal tracking.
    phone_wa: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[ServiceType] = mapped_column(_enum(ServiceType), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    price_per_kg_regular: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    price_per_kg_express: Mapped[Decimal] = mapped_column(Numeric(10, 2))


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_queue", "status", "is_express", "received_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tracking_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    service_type: Mapped[ServiceType] = mapped_column(_enum(ServiceType))
    is_express: Mapped[bool] = mapped_column(Boolean, default=False)
    weight_kg: Mapped[float] = mapped_column(Float)
    price_total: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    picked_up_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    status: Mapped[OrderStatus] = mapped_column(_enum(OrderStatus), default=OrderStatus.RECEIVED)

    predicted_ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_notified_eta: Mapped[datetime | None] = mapped_column(UTCDateTime)
    delay_notif_count: Mapped[int] = mapped_column(Integer, default=0)
    ready_notif_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    needs_followup: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    customer: Mapped[Customer] = relationship(lazy="joined")
    history: Mapped[list[OrderStatusHistory]] = relationship(
        back_populates="order", order_by="OrderStatusHistory.changed_at"
    )


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    from_status: Mapped[OrderStatus | None] = mapped_column(_enum(OrderStatus))
    to_status: Mapped[OrderStatus] = mapped_column(_enum(OrderStatus))
    changed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    order: Mapped[Order] = relationship(back_populates="history")


class DailyOperation(Base):
    __tablename__ = "daily_operations"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True)
    staff_on_duty: Mapped[int] = mapped_column(Integer)
    open_time: Mapped[time] = mapped_column(Time)
    close_time: Mapped[time] = mapped_column(Time)
    machine_issue_note: Mapped[str | None] = mapped_column(Text)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # Notifikasi siap diambil hanya boleh ada satu per pesanan.
        Index(
            "uq_notifications_ready_once",
            "order_id",
            unique=True,
            postgresql_where=text("type = 'READY'"),
            sqlite_where=text("type = 'READY'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    type: Mapped[NotificationType] = mapped_column(_enum(NotificationType))
    status: Mapped[NotificationStatus] = mapped_column(
        _enum(NotificationStatus), default=NotificationStatus.PENDING
    )
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    provider_msg_id: Mapped[str | None] = mapped_column(String(100))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class PredictionLog(Base):
    __tablename__ = "prediction_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    features_json: Mapped[dict] = mapped_column(JSON)
    predicted_minutes: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
