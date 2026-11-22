from datetime import timedelta
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import Customer, Order, OrderStatus
from app.services.queue import active_orders, is_ahead, is_escalated


def _create_simple_order(
    db: Session,
    tracking_code: str,
    status: OrderStatus,
    is_express: bool,
    received_at,
    promised_ready_at=None,
    predicted_ready_at=None,
) -> Order:
    customer = db.query(Customer).first()
    if not customer:
        customer = Customer(name="Test Customer", phone_wa="628123456789")
        db.add(customer)
        db.flush()

    order = Order(
        tracking_code=tracking_code,
        customer_id=customer.id,
        status=status,
        is_express=is_express,
        price_total=50000,
        received_at=received_at,
        promised_ready_at=promised_ready_at,
        predicted_ready_at=predicted_ready_at,
        delay_notif_count=0,
        ready_notif_sent=False,
        needs_followup=False,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def test_processing_regular_stays_ahead_of_received_express(db: Session) -> None:
    now = utcnow()
    reg_processing = _create_simple_order(
        db,
        tracking_code="REGPROC01",
        status=OrderStatus.PROCESSING,
        is_express=False,
        received_at=now - timedelta(hours=3),
        promised_ready_at=now + timedelta(hours=20),
    )
    exp_received = _create_simple_order(
        db,
        tracking_code="EXPREC01",
        status=OrderStatus.RECEIVED,
        is_express=True,
        received_at=now - timedelta(minutes=10),
        promised_ready_at=now + timedelta(hours=10),
    )

    # is_ahead checks
    assert is_ahead(reg_processing, exp_received, now=now) is True
    assert is_ahead(exp_received, reg_processing, now=now) is False

    # active_orders queue ordering
    queue = active_orders(db, now=now)
    ids = [o.id for o in queue]
    assert ids.index(reg_processing.id) < ids.index(exp_received.id)


def test_received_regular_with_over_threshold_yields_to_express(db: Session) -> None:
    now = utcnow()
    # 12 hours remaining (> 8 hours threshold)
    reg_received = _create_simple_order(
        db,
        tracking_code="REGREC01",
        status=OrderStatus.RECEIVED,
        is_express=False,
        received_at=now - timedelta(hours=2),
        promised_ready_at=now + timedelta(hours=12),
    )
    exp_received = _create_simple_order(
        db,
        tracking_code="EXPREC02",
        status=OrderStatus.RECEIVED,
        is_express=True,
        received_at=now - timedelta(hours=1),
        promised_ready_at=now + timedelta(hours=10),
    )

    assert is_escalated(reg_received, now=now) is False
    assert is_ahead(exp_received, reg_received, now=now) is True
    assert is_ahead(reg_received, exp_received, now=now) is False

    queue = active_orders(db, now=now)
    ids = [o.id for o in queue]
    assert ids.index(exp_received.id) < ids.index(reg_received.id)


def test_received_regular_with_under_threshold_escalates_to_express_tier(db: Session) -> None:
    now = utcnow()
    # reg_escalated received at T-3h, promised at T+6h (<= 8h remaining -> escalated)
    reg_escalated = _create_simple_order(
        db,
        tracking_code="REGESCAL01",
        status=OrderStatus.RECEIVED,
        is_express=False,
        received_at=now - timedelta(hours=3),
        promised_ready_at=now + timedelta(hours=6),
    )
    # exp_received received at T-1h (arrived after reg_escalated)
    exp_received = _create_simple_order(
        db,
        tracking_code="EXPREC03",
        status=OrderStatus.RECEIVED,
        is_express=True,
        received_at=now - timedelta(hours=1),
        promised_ready_at=now + timedelta(hours=12),
    )
    # reg_normal received at T-4h, promised at T+20h (> 8h remaining -> not escalated)
    reg_normal = _create_simple_order(
        db,
        tracking_code="REGNORM01",
        status=OrderStatus.RECEIVED,
        is_express=False,
        received_at=now - timedelta(hours=4),
        promised_ready_at=now + timedelta(hours=20),
    )

    assert is_escalated(reg_escalated, now=now) is True
    assert is_escalated(reg_normal, now=now) is False

    # Escalated regular arrived at T-3h, Express arrived at T-1h -> FIFO in high tier puts reg_escalated ahead!
    assert is_ahead(reg_escalated, exp_received, now=now) is True
    assert is_ahead(exp_received, reg_escalated, now=now) is False

    # Express arrived at T-1h, but reg_normal is not escalated -> Express ahead of reg_normal
    assert is_ahead(exp_received, reg_normal, now=now) is True
    assert is_ahead(reg_normal, exp_received, now=now) is False

    queue = active_orders(db, now=now)
    ids = [o.id for o in queue]
    assert ids.index(reg_escalated.id) < ids.index(exp_received.id)
    assert ids.index(exp_received.id) < ids.index(reg_normal.id)


