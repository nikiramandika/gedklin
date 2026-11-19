from __future__ import annotations

import logging
import re
import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
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
    PaymentMethod,
    PredictionLog,
    User,
)
from app.services import pricing
from app.services.activity import log_activity
from app.services.app_settings import AppConfig, day_ops_lookup, load_app_config, load_promises
from app.services.eta import PROMISE_VERSION, get_predictor
from app.services.notifications import describe_item, format_rupiah, should_send_delay
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
    add_work_hours,
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

STATUS_LABEL: dict[OrderStatus, str] = {
    OrderStatus.RECEIVED: "Diterima",
    OrderStatus.PROCESSING: "Diproses",
    OrderStatus.READY: "Siap Diambil",
    OrderStatus.PICKED_UP: "Sudah Diambil",
    OrderStatus.CANCELLED: "Dibatalkan",
}
PAYMENT_LABEL: dict[PaymentMethod, str] = {
    PaymentMethod.CASH: "Tunai",
    PaymentMethod.QRIS: "QRIS",
    PaymentMethod.TRANSFER: "Transfer",
}
EDITABLE_STATUSES = (OrderStatus.RECEIVED, OrderStatus.PROCESSING)

STATUS_FLOW: dict[OrderStatus, OrderStatus] = {
    OrderStatus.RECEIVED: OrderStatus.PROCESSING,
    OrderStatus.PROCESSING: OrderStatus.READY,
    OrderStatus.READY: OrderStatus.PICKED_UP,
}


class OrderError(ValueError):
    pass


# Nomor HP Indonesia: 08xx dengan total 10-13 digit, disimpan sebagai 628xx. Pelanggan tanpa
# WhatsApp boleh memakai nomor rumah (mis. 021-555-1234): kode area 02x-07x atau 09x,
# karena 08x selalu nomor HP dan tetap wajib lolos aturan HP.
PHONE_ALLOWED = re.compile(r"^\+?[\d\s().-]+$")
PHONE_MOBILE = re.compile(r"^628\d{8,11}$")
PHONE_LANDLINE = re.compile(r"^62[2-79]\d{6,11}$")


def normalize_phone(raw: str, *, mobile_only: bool = True) -> str:
    if not PHONE_ALLOWED.match(raw.strip()):
        raise OrderError("Nomor WhatsApp hanya boleh berisi angka")
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    elif digits.startswith("8"):
        digits = "62" + digits
    if not mobile_only and not PHONE_MOBILE.match(digits):
        if PHONE_LANDLINE.match(digits):
            return digits
        raise OrderError("Nomor telepon tidak valid. Mis. 0812-3456-7890 atau 021-555-1234")
    if not PHONE_MOBILE.match(digits):
        raise OrderError(
            "Nomor WhatsApp tidak valid. Pakai nomor HP, mis. 0812-3456-7890 (10-13 digit)"
        )
    return digits


def generate_tracking_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(TRACKING_ALPHABET) for _ in range(TRACKING_LENGTH))
        if db.scalar(select(Order.id).where(Order.tracking_code == code)) is None:
            return code


def next_status(order: Order) -> OrderStatus | None:
    return STATUS_FLOW.get(order.status)


def _clean(text: str | None, limit: int) -> str | None:
    text = (text or "").strip()
    return text[:limit] or None


def _order_items(quote: pricing.Quote) -> list[OrderItem]:
    return [
        OrderItem(
            catalog_code=i.catalog_code,
            name=i.name,
            group=i.group,
            process=i.process,
            weight_kg=i.weight_kg,
            qty_pcs=i.qty_pcs,
            machine_loads=i.machine_loads,
            extra_kg=i.extra_kg,
            extra_pcs=i.extra_pcs,
            is_express=i.is_express,
            subtotal=i.subtotal,
        )
        for i in quote.items
    ]


def _items_text(items: Sequence[OrderItem]) -> str:
    return ", ".join(describe_item(i) for i in items)


@dataclass
class EtaContext:
    config: AppConfig
    promises: dict[str, Promise]
    day_ops: DayOpsLookup

    @classmethod
    def load(cls, db: Session) -> EtaContext:
        config = load_app_config(db)
        return cls(config, load_promises(db), day_ops_lookup(db, config))


def order_promised_hours(order: Order, ctx: EtaContext) -> float:
    return promised_hours(order_content(order), ctx.promises, ctx.config.default_promise_hours)


def promised_ready_at(order: Order, ctx: EtaContext) -> datetime:
    hours = order_promised_hours(order, ctx)
    return shift_into_open_hours(order.received_at + timedelta(hours=hours), ctx.day_ops)


def compute_features(
    db: Session,
    order: Order,
    ctx: EtaContext,
    active: list[Order] | None = None,
    now: datetime | None = None,
) -> dict[str, float]:
    queue = queue_stats(order.received_at, records_active_at(db, order.received_at))
    if active is not None:
        now = now or utcnow()
        ahead = summarize_queue(queue_record(o, None) for o in active if is_ahead(o, order, now))
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
    features = compute_features(db, order, ctx, active, now)
    hours, version = get_predictor().predict_work_hours(features)
    if hours is None:
        eta = order.promised_ready_at or promised_ready_at(order, ctx)
        version = PROMISE_VERSION
    else:
        eta = add_work_hours(order.received_at, hours, ctx.day_ops)

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


def latest_model_version(db: Session, order_id: int) -> str | None:
    return db.scalar(
        select(PredictionLog.model_version)
        .where(PredictionLog.order_id == order_id)
        .order_by(PredictionLog.id.desc())
        .limit(1)
    )


def recompute_etas(db: Session, now: datetime | None = None) -> list[int]:
    now = now or utcnow()
    ctx = EtaContext.load(db)
    active = active_orders(db, now)
    delay_notifications: list[Notification] = []
    for order in active:
        before = latest_model_version(db, order.id)
        eta = predict_eta(db, order, ctx, active, now)
        db.flush()  # session tanpa autoflush: log prediksi baru harus terbaca
        after = latest_model_version(db, order.id)
        if before is not None and before != after:
            # Model diganti: ETA bergeser bukan karena antrean, jadi tanpa WA.
            order.last_notified_eta = eta
            continue
        if not order.customer.has_whatsapp:
            # Tanpa WhatsApp tidak ada kabar mundur; ETA tetap dicatat agar tidak menumpuk.
            order.last_notified_eta = eta
            continue
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


def upsert_customer(db: Session, name: str, phone_raw: str, has_whatsapp: bool = True) -> Customer:
    phone = normalize_phone(phone_raw, mobile_only=has_whatsapp)
    customer = db.scalar(select(Customer).where(Customer.phone_wa == phone))
    if customer is None:
        customer = Customer(name=name.strip(), phone_wa=phone, has_whatsapp=has_whatsapp)
        db.add(customer)
    else:
        if name.strip() and customer.name != name.strip():
            customer.name = name.strip()
        # Pilihan kasir di nota terbaru yang berlaku, mis. pelanggan baru saja pasang WhatsApp.
        customer.has_whatsapp = has_whatsapp
    db.flush()
    return customer


def quote_order(
    db: Session, items: Sequence[pricing.ItemRequest], is_express: bool
) -> pricing.Quote:
    config = load_app_config(db)
    try:
        return pricing.quote(
            db,
            items,
            is_express=is_express,
            express_multiplier=config.express_multiplier,
            machine_capacity_kg=config.machine_capacity_kg,
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
    notes: str | None = None,
    payment_method: PaymentMethod | None = None,
    now: datetime | None = None,
    customer_has_whatsapp: bool = True,
) -> Order:
    now = now or utcnow()
    quote = quote_order(db, items, is_express)
    customer = upsert_customer(db, customer_name, customer_phone, customer_has_whatsapp)
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
        notes=_clean(notes, 1000),
        payment_method=payment_method,
        paid_at=now if payment_method else None,
        items=_order_items(quote),
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
    log_activity(
        db,
        user,
        "order.create",
        f"Menerima pesanan {order.tracking_code} dari {customer.name} "
        f"({format_rupiah(order.price_total)}{', Express' if is_express else ''}"
        f"{f', lunas {PAYMENT_LABEL[payment_method]}' if payment_method else ''})",
        entity_id=order.tracking_code,
    )
    ctx = EtaContext.load(db)
    order.promised_ready_at = promised_ready_at(order, ctx)
    # ETA awal sudah tertulis di nota, jadi dianggap sudah diberitahukan.
    order.last_notified_eta = predict_eta(db, order, ctx)
    order.initial_predicted_ready_at = order.last_notified_eta
    receipt_notif = None
    if customer.has_whatsapp:
        receipt_notif = Notification(order_id=order.id, type=NotificationType.RECEIPT)
        db.add(receipt_notif)
    db.commit()
    if receipt_notif is not None:
        enqueue_notification(receipt_notif.id)
    recompute_etas(db, now)
    db.refresh(order)
    return order


def change_status(
    db: Session,
    order: Order,
    to_status: OrderStatus,
    user: User | None,
    now: datetime | None = None,
    *,
    rack_location: str | None = None,
    payment_method: PaymentMethod | None = None,
) -> Order:
    now = now or utcnow()
    if order.status == OrderStatus.CANCELLED:
        raise OrderError("Pesanan sudah dibatalkan")
    expected = next_status(order)
    if expected is None:
        raise OrderError("Pesanan sudah selesai diambil")
    if to_status != expected:
        raise OrderError(f"Status berikutnya harus {expected.value}")
    if to_status == OrderStatus.PICKED_UP and not order.is_paid:
        if payment_method is None:
            raise OrderError(
                f"Pesanan belum lunas ({format_rupiah(order.price_total)}). "
                "Catat pembayaran dulu sebelum cucian diserahkan."
            )
        _mark_paid(db, order, payment_method, user, now)

    from_status = order.status
    order.status = to_status
    ready_notif: Notification | None = None
    if to_status == OrderStatus.READY:
        order.ready_at = now
        if rack := _clean(rack_location, 20):
            order.rack_location = rack.upper()
        exists = db.scalar(
            select(Notification.id).where(
                Notification.order_id == order.id, Notification.type == NotificationType.READY
            )
        )
        if exists is None and order.customer.has_whatsapp:
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
    shelved = to_status == OrderStatus.READY and order.rack_location
    rack_note = f" di rak {order.rack_location}" if shelved else ""
    log_activity(
        db,
        user,
        "order.status",
        f"Mengubah status {order.tracking_code} ({order.customer.name}) "
        f"menjadi {STATUS_LABEL[to_status]}{rack_note}",
        entity_id=order.tracking_code,
        changes={"status": [STATUS_LABEL[from_status], STATUS_LABEL[to_status]]},
    )
    db.commit()
    if ready_notif is not None:
        enqueue_notification(ready_notif.id)
    recompute_etas(db, now)
    db.refresh(order)
    return order


def _mark_paid(
    db: Session, order: Order, method: PaymentMethod, user: User | None, now: datetime
) -> None:
    order.payment_method = method
    order.paid_at = now
    log_activity(
        db,
        user,
        "order.payment",
        f"Mencatat pembayaran {order.tracking_code} ({order.customer.name}) "
        f"{format_rupiah(order.price_total)} via {PAYMENT_LABEL[method]}",
        entity_id=order.tracking_code,
        changes={"pembayaran": ["Belum lunas", f"Lunas ({PAYMENT_LABEL[method]})"]},
    )


def record_payment(
    db: Session,
    order: Order,
    method: PaymentMethod,
    user: User | None,
    now: datetime | None = None,
) -> Order:
    if order.status == OrderStatus.CANCELLED:
        raise OrderError("Pesanan sudah dibatalkan")
    if order.is_paid:
        raise OrderError("Pesanan sudah lunas")
    _mark_paid(db, order, method, user, now or utcnow())
    db.commit()
    db.refresh(order)
    return order


def void_payment(db: Session, order: Order, user: User | None) -> Order:
    if not order.is_paid:
        raise OrderError("Pesanan belum lunas")
    method = order.payment_method
    order.payment_method = None
    order.paid_at = None
    log_activity(
        db,
        user,
        "order.payment_void",
        f"Membatalkan catatan pembayaran {order.tracking_code} ({order.customer.name})",
        entity_id=order.tracking_code,
        changes={
            "pembayaran": [f"Lunas ({PAYMENT_LABEL[method] if method else '-'})", "Belum lunas"]
        },
    )
    db.commit()
    db.refresh(order)
    return order


def update_details(
    db: Session,
    order: Order,
    user: User | None,
    *,
    fields: dict[str, str | None],
) -> Order:
    changes: dict[str, list[str | None]] = {}
    if "notes" in fields:
        notes = _clean(fields["notes"], 1000)
        if notes != order.notes:
            changes["catatan"] = [order.notes, notes]
            order.notes = notes
    if "rack_location" in fields:
        rack = _clean(fields["rack_location"], 20)
        rack = rack.upper() if rack else None
        if rack != order.rack_location:
            changes["rak"] = [order.rack_location, rack]
            order.rack_location = rack
    if changes:
        log_activity(
            db,
            user,
            "order.update",
            f"Mengubah {' dan '.join(changes)} pesanan {order.tracking_code} "
            f"({order.customer.name})",
            entity_id=order.tracking_code,
            changes=changes,
        )
        db.commit()
        db.refresh(order)
    return order


def _check_editable(order: Order, action: str) -> None:
    if order.status not in EDITABLE_STATUSES:
        raise OrderError(
            f"Pesanan yang sudah {STATUS_LABEL[order.status].lower()} tidak bisa {action}"
        )
    if order.is_paid:
        raise OrderError(
            f"Pesanan sudah lunas. Batalkan catatan pembayarannya dulu (pemilik) sebelum {action}."
        )


def update_items(
    db: Session,
    order: Order,
    items: Sequence[pricing.ItemRequest],
    is_express: bool,
    user: User | None,
    now: datetime | None = None,
) -> Order:
    now = now or utcnow()
    _check_editable(order, "dikoreksi")
    quote = quote_order(db, items, is_express)
    before_items, before_total = _items_text(order.items), order.price_total
    db.execute(delete(OrderItem).where(OrderItem.order_id == order.id))
    db.expire(order, ["items"])
    for item in _order_items(quote):
        item.order_id = order.id
        db.add(item)
    order.is_express = is_express
    order.price_total = quote.total
    db.flush()
    db.expire(order, ["items"])
    changes: dict[str, list[object]] = {"isi": [before_items, _items_text(order.items)]}
    if before_total != order.price_total:
        changes["total"] = [before_total, order.price_total]
    log_activity(
        db,
        user,
        "order.items",
        f"Mengoreksi isi pesanan {order.tracking_code} ({order.customer.name})",
        entity_id=order.tracking_code,
        changes=changes,
    )
    ctx = EtaContext.load(db)
    order.promised_ready_at = promised_ready_at(order, ctx)
    order.predicted_ready_at = None
    # Perkiraan baru dikirim ulang lewat nota, jadi tidak memicu WA.
    order.last_notified_eta = predict_eta(db, order, ctx, active_orders(db, now), now)
    order.initial_predicted_ready_at = order.last_notified_eta
    db.commit()
    recompute_etas(db, now)
    db.refresh(order)
    return order


def cancel_order(
    db: Session,
    order: Order,
    reason: str,
    user: User | None,
    now: datetime | None = None,
) -> Order:
    now = now or utcnow()
    _check_editable(order, "dibatalkan")
    reason_text = _clean(reason, 255)
    if not reason_text:
        raise OrderError("Isi alasan pembatalan")
    from_status = order.status
    order.status = OrderStatus.CANCELLED
    order.cancelled_at = now
    order.cancel_reason = reason_text
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=from_status,
            to_status=OrderStatus.CANCELLED,
            changed_at=now,
            changed_by=user.id if user else None,
        )
    )
    log_activity(
        db,
        user,
        "order.cancel",
        f"Membatalkan pesanan {order.tracking_code} ({order.customer.name}): {reason_text}",
        entity_id=order.tracking_code,
        changes={"status": [STATUS_LABEL[from_status], STATUS_LABEL[OrderStatus.CANCELLED]]},
    )
    db.commit()
    recompute_etas(db, now)
    db.refresh(order)
    return order


def mark_followups(db: Session, now: datetime | None = None) -> int:
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
