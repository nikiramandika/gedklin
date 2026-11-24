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
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, utcnow
from app.models.enums import (
    CatalogGroup,
    CatalogUnit,
    NotificationStatus,
    NotificationType,
    OrderStatus,
    PaymentMethod,
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
    # False: pelanggan tanpa WhatsApp; nomor hanya untuk ditelepon dan tidak ada WA yang dikirim.
    has_whatsapp: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ServiceCatalog(Base):
    __tablename__ = "service_catalog"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    group: Mapped[CatalogGroup] = mapped_column(_enum(CatalogGroup))
    process: Mapped[Process] = mapped_column(_enum(Process))
    unit: Mapped[CatalogUnit] = mapped_column(_enum(CatalogUnit))
    # NULL = harga belum diketahui (mis. dry clean); item belum bisa dipesan.
    price: Mapped[int | None] = mapped_column(Integer)
    extra_price: Mapped[int | None] = mapped_column(Integer)
    base_kg: Mapped[float | None] = mapped_column(Float)
    min_qty: Mapped[float | None] = mapped_column(Float)
    kg_per_load: Mapped[float | None] = mapped_column(Float)
    pcs_per_load: Mapped[int | None] = mapped_column(Integer)
    max_extra: Mapped[float | None] = mapped_column(Float)
    # Lama kerja (menit) per satuan harga: per pcs, per kg, atau per load. NULL = dihitung dari
    # muatan mesin dan tarif di Pengaturan, cocok untuk kiloan.
    work_minutes: Mapped[float | None] = mapped_column(Float)
    # Janji siap ke pelanggan (jam kalender). NULL = pakai janji default di Pengaturan.
    promise_hours: Mapped[int | None] = mapped_column(Integer)
    # Hanya untuk layanan yang bisa Express.
    express_promise_hours: Mapped[int | None] = mapped_column(Integer)
    express_eligible: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    # Text karena API key AI disimpan terenkripsi.
    value: Mapped[str] = mapped_column(Text)


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

    # Perkiraan siap di nota/lacak, tolok ukur terlambat, dan deadline penjadwalan LST.
    promised_ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    ready_notif_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    needs_followup: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    notes: Mapped[str | None] = mapped_column(Text)
    rack_location: Mapped[str | None] = mapped_column(String(20))
    # paid_at NULL = belum lunas.
    payment_method: Mapped[PaymentMethod | None] = mapped_column(_enum(PaymentMethod))
    paid_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancel_reason: Mapped[str | None] = mapped_column(String(255))

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    customer: Mapped[Customer] = relationship(lazy="joined")
    creator: Mapped[User | None] = relationship(lazy="joined")
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", order_by="OrderItem.id", lazy="selectin"
    )
    history: Mapped[list[OrderStatusHistory]] = relationship(
        back_populates="order", order_by="OrderStatusHistory.changed_at"
    )

    @property
    def is_paid(self) -> bool:
        return self.paid_at is not None

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None


class OrderItem(Base):
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
    # Untuk fitur ML, terpisah dari harga.
    machine_loads: Mapped[int | None] = mapped_column(Integer)
    extra_kg: Mapped[int | None] = mapped_column(Integer)
    extra_pcs: Mapped[int | None] = mapped_column(Integer)
    is_express: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
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
    changer: Mapped[User | None] = relationship(lazy="joined")

    @property
    def changed_by_name(self) -> str | None:
        return self.changer.name if self.changer else None


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
        Index(
            "uq_notifications_ready_once",
            "order_id",
            unique=True,
            postgresql_where=text("type = 'READY'"),
            sqlite_where=text("type = 'READY'"),
        ),
        Index(
            "uq_notifications_receipt_once",
            "order_id",
            unique=True,
            postgresql_where=text("type = 'RECEIPT'"),
            sqlite_where=text("type = 'RECEIPT'"),
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


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # NULL = sistem (mis. tugas terjadwal).
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity_type: Mapped[str] = mapped_column(String(20), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(40))
    summary: Mapped[str] = mapped_column(String(255))
    # Password tidak pernah dicatat di sini.
    changes: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    user: Mapped[User | None] = relationship(lazy="joined")

    @property
    def user_name(self) -> str | None:
        return self.user.name if self.user else None


class AiAnalysis(Base):
    """Riwayat analisis AI atas laporan, supaya hasil lama bisa dibuka tanpa memanggil AI lagi."""

    __tablename__ = "ai_analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    # NULL = analisis umum tanpa pertanyaan.
    question: Mapped[str | None] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(100))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    creator: Mapped[User | None] = relationship(lazy="joined")

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None
