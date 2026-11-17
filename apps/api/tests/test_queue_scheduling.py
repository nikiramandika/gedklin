from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import Customer, Order, OrderStatus
from app.services.queue import active_orders, is_ahead, is_escalated


def _order(
    db: Session,
    code: str,
    *,
    status: OrderStatus = OrderStatus.RECEIVED,
    express: bool = False,
    received_at: datetime,
    promised_ready_at: datetime | None = None,
) -> Order:
    customer = db.query(Customer).first()
    if customer is None:
        customer = Customer(name="Pelanggan", phone_wa="628123456789")
        db.add(customer)
        db.flush()
    order = Order(
        tracking_code=code,
        customer_id=customer.id,
        status=status,
        is_express=express,
        price_total=50_000,
        received_at=received_at,
        promised_ready_at=promised_ready_at,
        delay_notif_count=0,
        ready_notif_sent=False,
        needs_followup=False,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def _codes(db: Session, now: datetime) -> list[str]:
    return [o.tracking_code for o in active_orders(db, now)]


def test_processing_order_is_not_overtaken_by_express(db: Session) -> None:
    now = utcnow()
    started = _order(
        db,
        "REGPROC",
        status=OrderStatus.PROCESSING,
        received_at=now - timedelta(hours=3),
        promised_ready_at=now + timedelta(hours=40),
    )
    express = _order(
        db,
        "EXPREC",
        express=True,
        received_at=now - timedelta(minutes=10),
        promised_ready_at=now + timedelta(hours=20),
    )
    assert is_ahead(started, express, now)
    assert not is_ahead(express, started, now)
    assert _codes(db, now) == ["REGPROC", "EXPREC"]


def test_express_first_then_regular_near_promise_then_fifo(db: Session) -> None:
    now = utcnow()
    _order(
        db,
        "REGJAUH",
        received_at=now - timedelta(hours=10),
        promised_ready_at=now + timedelta(hours=60),
    )
    near = _order(
        db,
        "REGDEKAT",
        received_at=now - timedelta(hours=5),
        promised_ready_at=now + timedelta(hours=6),
    )
    _order(
        db,
        "EXP",
        express=True,
        received_at=now - timedelta(hours=1),
        promised_ready_at=now + timedelta(hours=23),
    )
    assert is_escalated(near, now)
    assert _codes(db, now) == ["EXP", "REGDEKAT", "REGJAUH"]


def test_regular_past_promise_stays_escalated(db: Session) -> None:
    now = utcnow()
    late = _order(
        db,
        "REGLEWAT",
        received_at=now - timedelta(hours=60),
        promised_ready_at=now - timedelta(hours=2),
    )
    assert is_escalated(late, now)
    assert not is_escalated(late, now - timedelta(hours=20))
