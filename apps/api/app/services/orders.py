"""Logika pesanan: pembuatan, perubahan status, ETA, dan aturan notifikasi."""

from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import utcnow
from app.models import (
    Customer,
    Notification,
    NotificationType,
    Order,
    OrderStatus,
    OrderStatusHistory,
    PredictionLog,
    Service,
    ServiceType,
    User,
)
from app.services.eta import get_predictor
from app.services.notifications import should_send_delay
from app.services.queue import active_orders, daily_operation_for, is_ahead, records_active_at
from gedklin_ml.features import build_features, local_date, queue_stats

logger = logging.getLogger(__name__)

TRACKING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TRACKING_LENGTH = 10


class OrderError(ValueError):
    pass


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    elif digits.startswith("8"):
        digits = "62" + digits
    if not digits.startswith("62") or not 10 <= len(digits) <= 15:
        raise OrderError("Nomor WhatsApp tidak valid")
    return digits


def generate_tracking_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(TRACKING_ALPHABET) for _ in range(TRACKING_LENGTH))
        if db.scalar(select(Order.id).where(Order.tracking_code == code)) is None:
            return code


def next_status(order: Order) -> OrderStatus | None:
    flow = {
        OrderStatus.RECEIVED: OrderStatus.WASHING,
        OrderStatus.WASHING: OrderStatus.DRYING,
        OrderStatus.DRYING: (
            OrderStatus.IRONING if order.service_type == ServiceType.CKS else OrderStatus.READY
        ),
        OrderStatus.IRONING: OrderStatus.READY,
        OrderStatus.READY: OrderStatus.PICKED_UP,
    }
    return flow.get(order.status)


# --- ETA -------------------------------------------------------------------


def compute_features(
    db: Session, order: Order, active: list[Order] | None = None
) -> dict[str, float]:
    """Fitur pesanan memakai feature builder yang sama dengan training.

    Kondisi antrean dihitung pada saat pesanan masuk. Saat ETA dihitung ulang
    (`active` diisi), dipakai nilai terbesar antara antrean saat masuk dan
    pesanan yang kini berada di depannya, supaya Express yang menyela dan
    antrean yang tidak berkurang ikut tercermin.
    """
    count, kg = queue_stats(order.received_at, records_active_at(db, order.received_at))
    if active is not None:
        ahead = [o for o in active if is_ahead(o, order)]
        count = max(count, len(ahead))
        kg = max(kg, round(sum(o.weight_kg for o in ahead), 2))
    daily = daily_operation_for(db, local_date(order.received_at))
    return build_features(
        received_at=order.received_at,
        weight_kg=order.weight_kg,
        service_type=order.service_type.value,
        is_express=order.is_express,
        active_orders_count=count,
        active_kg_total=kg,
        staff_on_duty=daily.staff_on_duty if daily else None,
        close_time=daily.close_time if daily else None,
    )


def predict_eta(
    db: Session, order: Order, active: list[Order] | None = None, now: datetime | None = None
) -> datetime:
    features = compute_features(db, order, active)
    minutes, version = get_predictor().predict_minutes(features)
    eta = order.received_at + timedelta(minutes=minutes)
    if now is not None and eta <= now:
        # Sudah lewat ETA tapi belum READY: geser ke depan.
        eta = now + timedelta(minutes=get_settings().overdue_buffer_minutes)

    previous = order.predicted_ready_at
    if previous is None or abs(eta - previous) >= timedelta(minutes=1):
        db.add(
            PredictionLog(
                order_id=order.id,
                features_json=features,
                predicted_minutes=round((eta - order.received_at) / timedelta(minutes=1), 2),
                model_version=version,
            )
        )
        order.predicted_ready_at = eta
    return order.predicted_ready_at or eta


def recompute_etas(db: Session, now: datetime | None = None) -> list[int]:
    """Hitung ulang ETA pesanan aktif dan antrekan notifikasi keterlambatan."""
    now = now or utcnow()
    active = active_orders(db)
    delay_notifications: list[Notification] = []
    for order in active:
        eta = predict_eta(db, order, active, now)
        if should_send_delay(order, eta):
            order.last_notified_eta = eta
            order.delay_notif_count += 1
            notif = Notification(order_id=order.id, type=NotificationType.DELAY)
            db.add(notif)
            delay_notifications.append(notif)
    db.commit()
    for notif in delay_notifications:
        enqueue_notification(notif.id)
    return [n.order_id for n in delay_notifications]


# --- Pesanan ---------------------------------------------------------------


def upsert_customer(db: Session, name: str, phone_raw: str) -> Customer:
    phone = normalize_phone(phone_raw)
    customer = db.scalar(select(Customer).where(Customer.phone_wa == phone))
    if customer is None:
        customer = Customer(name=name.strip(), phone_wa=phone)
        db.add(customer)
    elif name.strip() and customer.name != name.strip():
        customer.name = name.strip()
    db.flush()
    return customer


def create_order(
    db: Session,
    *,
    customer_name: str,
    customer_phone: str,
    service_type: ServiceType,
    is_express: bool,
    weight_kg: float,
    user: User | None,
    now: datetime | None = None,
) -> Order:
    now = now or utcnow()
    if weight_kg <= 0:
        raise OrderError("Berat harus lebih dari 0 kg")
    service = db.scalar(select(Service).where(Service.code == service_type))
    if service is None:
        raise OrderError(f"Layanan {service_type} belum diatur")

    customer = upsert_customer(db, customer_name, customer_phone)
    price_per_kg = service.price_per_kg_express if is_express else service.price_per_kg_regular
    order = Order(
        tracking_code=generate_tracking_code(db),
        customer=customer,
        service_type=service_type,
        is_express=is_express,
        weight_kg=weight_kg,
        price_total=(Decimal(str(weight_kg)) * price_per_kg).quantize(Decimal("1")),
        received_at=now,
        status=OrderStatus.RECEIVED,
        delay_notif_count=0,
        ready_notif_sent=False,
        needs_followup=False,
        created_by=user.id if user else None,
    )
    db.add(order)
    db.flush()
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=None,
            to_status=OrderStatus.RECEIVED,
            changed_at=now,
            changed_by=order.created_by,
        )
    )
    # ETA awal dicantumkan di nota, jadi dianggap sudah diberitahukan.
    order.last_notified_eta = predict_eta(db, order)
    db.commit()
    recompute_etas(db, now)
    db.refresh(order)
    return order


def change_status(
    db: Session,
    order: Order,
    to_status: OrderStatus,
    user: User | None,
    now: datetime | None = None,
) -> Order:
    now = now or utcnow()
    expected = next_status(order)
    if expected is None:
        raise OrderError("Pesanan sudah selesai diambil")
    if to_status != expected:
        raise OrderError(f"Status berikutnya harus {expected.value}")

    from_status = order.status
    order.status = to_status
    ready_notif: Notification | None = None
    if to_status == OrderStatus.READY:
        order.ready_at = now
        exists = db.scalar(
            select(Notification.id).where(
                Notification.order_id == order.id, Notification.type == NotificationType.READY
            )
        )
        if exists is None:
            ready_notif = Notification(order_id=order.id, type=NotificationType.READY)
            db.add(ready_notif)
    elif to_status == OrderStatus.PICKED_UP:
        order.picked_up_at = now
        order.needs_followup = False

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=from_status,
            to_status=to_status,
            changed_at=now,
            changed_by=user.id if user else None,
        )
    )
    db.commit()
    if ready_notif is not None:
        enqueue_notification(ready_notif.id)
    recompute_etas(db, now)
    db.refresh(order)
    return order


def mark_followups(db: Session, now: datetime | None = None) -> int:
    """Tandai pesanan READY yang belum diambil lebih dari N hari. Tanpa WA otomatis."""
    now = now or utcnow()
    cutoff = now - timedelta(days=get_settings().followup_after_days)
    result = db.execute(
        update(Order)
        .where(
            Order.status == OrderStatus.READY,
            Order.ready_at < cutoff,
            Order.needs_followup.is_(False),
        )
        .values(needs_followup=True)
    )
    db.commit()
    return result.rowcount or 0


def enqueue_notification(notification_id: int) -> None:
    from app.workers.tasks import send_notification

    try:
        send_notification.delay(notification_id)
    except Exception:
        # Broker mati tidak boleh menggagalkan transaksi kasir; status tetap PENDING.
        logger.exception("Gagal mengantrekan notifikasi %s", notification_id)
