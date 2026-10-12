from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, utcnow
from app.models.enums import (
    CatalogGroup,
    CatalogUnit,
    NotificationStatus,
    NotificationType,
    OrderStatus,
    Process,
    Role,
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


class ServiceCatalog(Base):
    """Price list mitra. Di-seed dari seed/price_catalog.json, harga diubah pemilik."""

    __tablename__ = "service_catalog"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    group: Mapped[CatalogGroup] = mapped_column(_enum(CatalogGroup))
    process: Mapped[Process] = mapped_column(_enum(Process))
    unit: Mapped[CatalogUnit] = mapped_column(_enum(CatalogUnit))
    # Rupiah. LOAD_7KG/LOAD: per load, KG: per kg, PCS: per potong.
    price: Mapped[int] = mapped_column(Integer)
    # Tambahan per kg (LOAD_7KG) atau per pcs (LOAD).
    extra_price: Mapped[int | None] = mapped_column(Integer)
    # Aturan min/maks.
    min_qty: Mapped[float | None] = mapped_column(Float)
    kg_per_load: Mapped[float | None] = mapped_column(Float)
    pcs_per_load: Mapped[int | None] = mapped_column(Integer)
    max_extra: Mapped[float | None] = mapped_column(Float)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ServicePromise(Base):
    """Janji waktu standar mitra per proses (jam kalender). NULL = belum diketahui."""

    __tablename__ = "service_promise"

    id: Mapped[int] = mapped_column(primary_key=True)
    process: Mapped[Process] = mapped_column(_enum(Process), unique=True)
    regular_hours: Mapped[int | None] = mapped_column(Integer)
    express_hours: Mapped[int | None] = mapped_column(Integer)
    # Batas bawah janji Reguler (mis. CKS 3-4 hari -> 72).
    min_regular_hours: Mapped[int | None] = mapped_column(Integer)


class AppSetting(Base):
    """Pengaturan yang bisa diubah pemilik, mis. express_multiplier."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(100))


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_queue", "status", "is_express", "received_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tracking_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    is_express: Mapped[bool] = mapped_column(Boolean, default=False)
    price_total: Mapped[int] = mapped_column(Integer)

    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    picked_up_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    status: Mapped[OrderStatus] = mapped_column(_enum(OrderStatus), default=OrderStatus.RECEIVED)

    # Janji standar mitra, juga fallback ETA bila model tidak tersedia.
    promised_ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    predicted_ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_notified_eta: Mapped[datetime | None] = mapped_column(UTCDateTime)
    delay_notif_count: Mapped[int] = mapped_column(Integer, default=0)
    ready_notif_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    needs_followup: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    customer: Mapped[Customer] = relationship(lazy="joined")
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", order_by="OrderItem.id", lazy="selectin"
    )
    history: Mapped[list[OrderStatusHistory]] = relationship(
        back_populates="order", order_by="OrderStatusHistory.changed_at"
    )


class OrderItem(Base):
    """Satu baris pesanan, mis. 6 kg CKS, 1 bed cover, atau 2 kemeja."""

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    catalog_code: Mapped[str] = mapped_column(ForeignKey("service_catalog.code"))
    # Salinan saat transaksi supaya nota tetap sama walau katalog diubah.
    name: Mapped[str] = mapped_column(String(100))
    group: Mapped[CatalogGroup] = mapped_column(_enum(CatalogGroup))
    process: Mapped[Process] = mapped_column(_enum(Process))
    weight_kg: Mapped[float | None] = mapped_column(Float)
    qty_pcs: Mapped[int | None] = mapped_column(Integer)
    loads: Mapped[int | None] = mapped_column(Integer)
    extra_kg: Mapped[int | None] = mapped_column(Integer)
    extra_pcs: Mapped[int | None] = mapped_column(Integer)
    subtotal: Mapped[int] = mapped_column(Integer)

    order: Mapped[Order] = relationship(back_populates="items")


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
    is_open: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    staff_on_duty: Mapped[int] = mapped_column(Integer, default=2)
    washers_available: Mapped[int] = mapped_column(Integer, default=4, server_default="4")
    dryers_available: Mapped[int] = mapped_column(Integer, default=3, server_default="3")
    open_time: Mapped[time] = mapped_column(Time, default=time(8, 0))
    close_time: Mapped[time] = mapped_column(Time, default=time(17, 0))
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
    predicted_hours: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
