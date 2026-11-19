from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import utcnow
from app.models import ACTIVE_STATUSES, Order, OrderStatus
from gedklin_ml.features import OrderContent, QueueRecord, content_from_items


def is_escalated(order: Order, now: datetime, threshold_hours: float | None = None) -> bool:
    if order.is_express or order.promised_ready_at is None:
        return False
    if threshold_hours is None:
        threshold_hours = get_settings().regular_escalation_hours
    return order.promised_ready_at - now <= timedelta(hours=threshold_hours)


def queue_rank(
    order: Order, now: datetime, threshold_hours: float | None = None
) -> tuple[int, int, datetime, int]:
    # Reguler yang mendekati janji masuk kelompok Express dan diurutkan FIFO bersama, supaya
    # Express yang datang belakangan tidak terus menyalipnya sampai lewat janji.
    started = 0 if order.status == OrderStatus.PROCESSING else 1
    priority = order.is_express or is_escalated(order, now, threshold_hours)
    tier = 0 if priority else 1
    return started, tier, order.received_at, order.id


def active_orders(db: Session, now: datetime | None = None) -> list[Order]:
    now = now or utcnow()
    threshold = get_settings().regular_escalation_hours
    orders = db.scalars(select(Order).where(Order.status.in_(ACTIVE_STATUSES)))
    return sorted(orders, key=lambda o: queue_rank(o, now, threshold))


def order_content(order: Order) -> OrderContent:
    return content_from_items(order.items, order.is_express)


def queue_record(order: Order, ready_at: datetime | None) -> QueueRecord:
    return QueueRecord.from_content(order.received_at, ready_at, order_content(order))


def left_queue_at(order: Order) -> datetime | None:
    return order.ready_at or order.cancelled_at


def records_active_at(db: Session, at: datetime) -> list[QueueRecord]:
    stmt = select(Order).where(
        Order.received_at < at,
        or_(Order.ready_at.is_(None), Order.ready_at > at),
        or_(Order.cancelled_at.is_(None), Order.cancelled_at > at),
    )
    return [queue_record(o, left_queue_at(o)) for o in db.scalars(stmt)]


def is_ahead(other: Order, order: Order, now: datetime) -> bool:
    if other.id == order.id:
        return False
    return queue_rank(other, now) < queue_rank(order, now)
