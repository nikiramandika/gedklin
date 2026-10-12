"""Antrean berbasis aturan: Express dulu, lalu FIFO berdasarkan waktu masuk."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import ACTIVE_STATUSES, DailyOperation, Order
from gedklin_ml.features import QueueRecord


def active_orders(db: Session) -> list[Order]:
    stmt = (
        select(Order)
        .where(Order.status.in_(ACTIVE_STATUSES))
        .order_by(Order.is_express.desc(), Order.received_at.asc(), Order.id.asc())
    )
    return list(db.scalars(stmt))


def records_active_at(db: Session, at: datetime) -> list[QueueRecord]:
    """Pesanan yang sudah masuk sebelum `at` dan belum READY pada saat itu."""
    stmt = select(Order.received_at, Order.ready_at, Order.weight_kg).where(
        Order.received_at < at, or_(Order.ready_at.is_(None), Order.ready_at > at)
    )
    return [QueueRecord(r.received_at, r.ready_at, r.weight_kg) for r in db.execute(stmt)]


def is_ahead(other: Order, order: Order) -> bool:
    """True jika `other` diproses lebih dulu dari `order` menurut aturan antrean."""
    if other.id == order.id:
        return False
    if other.is_express != order.is_express:
        return other.is_express
    return (other.received_at, other.id) < (order.received_at, order.id)


def daily_operation_for(db: Session, day: date) -> DailyOperation | None:
    return db.scalar(select(DailyOperation).where(DailyOperation.date == day))
