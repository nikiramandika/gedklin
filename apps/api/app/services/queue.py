"""Antrean berbasis aturan: Express dulu, lalu FIFO berdasarkan waktu masuk."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import ACTIVE_STATUSES, Order
from gedklin_ml.features import OrderContent, QueueRecord, content_from_items


def active_orders(db: Session) -> list[Order]:
    stmt = (
        select(Order)
        .where(Order.status.in_(ACTIVE_STATUSES))
        .order_by(Order.is_express.desc(), Order.received_at.asc(), Order.id.asc())
    )
    return list(db.scalars(stmt))


def order_content(order: Order) -> OrderContent:
    return content_from_items(order.items, order.is_express)


def queue_record(order: Order, ready_at: datetime | None) -> QueueRecord:
    return QueueRecord.from_content(order.received_at, ready_at, order_content(order))


def records_active_at(db: Session, at: datetime) -> list[QueueRecord]:
    """Pesanan yang sudah masuk sebelum `at` dan belum READY pada saat itu."""
    stmt = select(Order).where(
        Order.received_at < at, or_(Order.ready_at.is_(None), Order.ready_at > at)
    )
    return [queue_record(o, o.ready_at) for o in db.scalars(stmt)]


def is_ahead(other: Order, order: Order) -> bool:
    """True jika `other` diproses lebih dulu dari `order` menurut aturan antrean."""
    if other.id == order.id:
        return False
    if other.is_express != order.is_express:
        return other.is_express
    return (other.received_at, other.id) < (order.received_at, order.id)
