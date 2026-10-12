"""Logika pesanan: pembuatan, perubahan status, janji waktu, ETA, dan aturan notifikasi."""

from __future__ import annotations

import logging
import re
import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import utcnow
from app.models import (
    Customer,
    Notification,
    NotificationType,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    PredictionLog,
    User,
)
from app.services import pricing
from app.services.app_settings import AppConfig, day_ops_lookup, load_app_config, load_promises
from app.services.eta import PROMISE_VERSION, get_predictor
from app.services.notifications import should_send_delay
from app.services.queue import (
    active_orders,
    is_ahead,
    order_content,
    queue_record,
    records_active_at,
)
from gedklin_ml.features import (
    DayOpsLookup,
    Promise,
    build_features,
    local_date,
    promised_hours,
    queue_stats,
    shift_into_open_hours,
    summarize_queue,
)

logger = logging.getLogger(__name__)

TRACKING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TRACKING_LENGTH = 10

STATUS_FLOW: dict[OrderStatus, OrderStatus] = {
    OrderStatus.RECEIVED: OrderStatus.PROCESSING,
    OrderStatus.PROCESSING: OrderStatus.READY,
    OrderStatus.READY: OrderStatus.PICKED_UP,
}


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
    return STATUS_FLOW.get(order.status)


# --- Janji & ETA -----------------------------------------------------------


@dataclass
class EtaContext:
    """Pengaturan yang dibaca sekali per perhitungan ulang ETA."""

    config: AppConfig
    promises: dict[str, Promise]
    day_ops: DayOpsLookup

    @classmethod
    def load(cls, db: Session) -> EtaContext:
        config = load_app_config(db)
        return cls(config, load_promises(db), day_ops_lookup(db, config))


def order_promised_hours(order: Order, ctx: EtaContext) -> float:
    content = order_content(order)
    return promised_hours(
        content.processes, order.is_express, ctx.promises, ctx.config.default_promise_hours
    )


def promised_ready_at(order: Order, ctx: EtaContext) -> datetime:
    """Janji standar mitra; bila jatuh di luar jam buka, geser ke jam buka berikutnya."""
    hours = order_promised_hours(order, ctx)
    return shift_into_open_hours(order.received_at + timedelta(hours=hours), ctx.day_ops)


def compute_features(
    db: Session, order: Order, ctx: EtaContext, active: list[Order] | None = None
) -> dict[str, float]:
    """Fitur pesanan memakai feature builder yang sama dengan training.

    Kondisi antrean dihitung pada saat pesanan masuk. Saat ETA dihitung ulang
    (`active` diisi), dipakai nilai terbesar antara antrean saat masuk dan
    pesanan yang kini berada di depannya, supaya Express yang menyela dan
    antrean yang tidak berkurang ikut tercermin.
    """
    queue = queue_stats(order.received_at, records_active_at(db, order.received_at))
    if active is not None:
        ahead = summarize_queue(queue_record(o, None) for o in active if is_ahead(o, order))
        queue = queue.max(ahead)
    return build_features(
        received_at=order.received_at,
        content=order_content(order),
        queue=queue,
        day=ctx.day_ops(local_date(order.received_at)),
        promised_hours=order_promised_hours(order, ctx),
    )


def predict_eta(
    db: Session,
    order: Order,
    ctx: EtaContext,
    active: list[Order] | None = None,
    now: datetime | None = None,
) -> datetime:
    features = compute_features(db, order, ctx, active)
    hours, version = get_predictor().predict_hours(features)
    if hours is None:
        # Model tidak tersedia: fallback ke janji standar mitra.
        eta = order.promised_ready_at or promised_ready_at(order, ctx)
        version = PROMISE_VERSION
    else:
        eta = shift_into_open_hours(order.received_at + timedelta(hours=hours), ctx.day_ops)
    if now is not None and eta <= now:
        # Sudah lewat ETA tapi belum READY: geser ke depan.
        buffer = timedelta(minutes=get_settings().overdue_buffer_minutes)
        eta = shift_into_open_hours(now + buffer, ctx.day_ops)

    previous = order.predicted_ready_at
    if previous is None or abs(eta - previous) >= timedelta(minutes=1):
        db.add(
            PredictionLog(
                order_id=order.id,
                features_json=features,
                predicted_hours=round((eta - order.received_at) / timedelta(hours=1), 3),
                model_version=version,
            )
        )
        order.predicted_ready_at = eta
    return order.predicted_ready_at or eta


def recompute_etas(db: Session, now: datetime | None = None) -> list[int]:
    """Hitung ulang ETA pesanan aktif dan antrekan notifikasi keterlambatan."""
    now = now or utcnow()
    ctx = EtaContext.load(db)
    active = active_orders(db)
    delay_notifications: list[Notification] = []
    for order in active:
        eta = predict_eta(db, order, ctx, active, now)
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


def quote_order(
    db: Session, items: Sequence[pricing.ItemRequest], is_express: bool
) -> pricing.Quote:
    try:
        return pricing.quote(
            db,
            items,
            is_express=is_express,
            express_multiplier=load_app_config(db).express_multiplier,
        )
    except pricing.PricingError as exc:
        raise OrderError(str(exc)) from exc


def create_order(
    db: Session,
    *,
    customer_name: str,
    customer_phone: str,
    is_express: bool,
    items: Sequence[pricing.ItemRequest],
    user: User | None,
    now: datetime | None = None,
) -> Order:
    now = now or utcnow()
    quote = quote_order(db, items, is_express)
    customer = upsert_customer(db, customer_name, customer_phone)
    order = Order(
        tracking_code=generate_tracking_code(db),
        customer=customer,
        is_express=is_express,
        price_total=quote.total,
        received_at=now,
        status=OrderStatus.RECEIVED,
        delay_notif_count=0,
        ready_notif_sent=False,
        needs_followup=False,
        created_by=user.id if user else None,
        items=[
            OrderItem(
                catalog_code=i.catalog_code,
                name=i.name,
                group=i.group,
                process=i.process,
                weight_kg=i.weight_kg,
                qty_pcs=i.qty_pcs,
                loads=i.loads,
                extra_kg=i.extra_kg,
                extra_pcs=i.extra_pcs,
                subtotal=i.subtotal,
            )
            for i in quote.items
        ],
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
    ctx = EtaContext.load(db)
    order.promised_ready_at = promised_ready_at(order, ctx)
    # ETA awal dicantumkan di nota, jadi dianggap sudah diberitahukan.
    order.last_notified_eta = predict_eta(db, order, ctx)
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
