"""Antrean berbasis aturan: PROCESSING dulu, lalu Express/Eskalasi, lalu FIFO."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import and_, case, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import utcnow
from app.models import ACTIVE_STATUSES, Order, OrderStatus
from gedklin_ml.features import OrderContent, QueueRecord, content_from_items


def is_escalated(
    order: Order,
    now: datetime | None = None,
    threshold_hours: int | None = None,
) -> bool:
    """True jika pesanan Reguler mendekati SLA sehingga prioritasnya dieskalasi."""
    if order.is_express or order.promised_ready_at is None:
        return False
    now = now or utcnow()
    threshold = (
        threshold_hours
        if threshold_hours is not None
        else get_settings().regular_escalation_threshold_hours
    )
    return order.promised_ready_at - now <= timedelta(hours=threshold)


def active_orders(db: Session, now: datetime | None = None) -> list[Order]:
    now = now or utcnow()
    cutoff = now + timedelta(hours=get_settings().regular_escalation_threshold_hours)
    status_order = case((Order.status == OrderStatus.PROCESSING, 0), else_=1)
    tier_order = case(
        (
            or_(
                Order.is_express.is_(True),
                and_(
                    Order.promised_ready_at.is_not(None),
                    Order.promised_ready_at <= cutoff,
                ),
            ),
            0,
        ),
        else_=1,
    )
    stmt = (
        select(Order)
        .where(Order.status.in_(ACTIVE_STATUSES))
        .order_by(
            status_order.asc(),
            tier_order.asc(),
            Order.received_at.asc(),
            Order.id.asc(),
        )
    )
    return list(db.scalars(stmt))


def order_content(order: Order) -> OrderContent:
    return content_from_items(order.items, order.is_express)


def queue_record(order: Order, ready_at: datetime | None) -> QueueRecord:
    return QueueRecord.from_content(order.received_at, ready_at, order_content(order))


def left_queue_at(order: Order) -> datetime | None:
    """Kapan pesanan keluar dari antrean: saat READY, atau saat dibatalkan."""
    return order.ready_at or order.cancelled_at


def records_active_at(db: Session, at: datetime) -> list[QueueRecord]:
    """Pesanan yang sudah masuk sebelum `at` dan belum READY/batal pada saat itu."""
    stmt = select(Order).where(
        Order.received_at < at,
        or_(Order.ready_at.is_(None), Order.ready_at > at),
        or_(Order.cancelled_at.is_(None), Order.cancelled_at > at),
    )
    return [queue_record(o, left_queue_at(o)) for o in db.scalars(stmt)]


def is_ahead(other: Order, order: Order, now: datetime | None = None) -> bool:
    """True jika `other` diproses lebih dulu dari `order` menurut aturan antrean.

    Aturan urutan:
    1. Pesanan PROCESSING selalu lebih dulu dari RECEIVED (apapun status Express-nya).
    2. Dalam status yang sama: tier Express / Eskalasi Reguler lebih dulu dari Reguler normal.
    3. Dalam tier yang sama: FIFO berdasarkan (received_at, id).
    """
    if other.id == order.id:
        return False

    # 1. Status precedence: PROCESSING > RECEIVED
    if other.status != order.status:
        if other.status == OrderStatus.PROCESSING and order.status == OrderStatus.RECEIVED:
            return True
        if other.status == OrderStatus.RECEIVED and order.status == OrderStatus.PROCESSING:
            return False

    # 2. Priority tier: Express atau Reguler yang dieskalasi (<= 8 jam menuju SLA)
    other_high = other.is_express or is_escalated(other, now)
    order_high = order.is_express or is_escalated(order, now)

    if other_high != order_high:
        return other_high

    # 3. FIFO
    return (other.received_at, other.id) < (order.received_at, order.id)
