"""Data contoh untuk demo dan screenshot laporan: pelanggan, pesanan 60 hari, operasional harian.

Jalankan setelah `python -m app.seed`:
    python -m app.seed_demo            # tambah data contoh
    python -m app.seed_demo --hapus    # hapus lagi semua data contoh

Data contoh dikenali dari nomor pelanggannya (62812990xxxxx / 6261990xxxx), jadi pesanan asli
tidak ikut terhapus. Jangan dijalankan di production. Tidak ada WA yang dikirim.
"""

from __future__ import annotations

import argparse
import random
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, utcnow
from app.models import (
    ActivityLog,
    Customer,
    DailyOperation,
    Notification,
    NotificationStatus,
    NotificationType,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    PaymentMethod,
    PredictionLog,
    Role,
    User,
)
from app.security import hash_password
from app.services import pricing
from app.services.app_settings import load_app_config
from app.services.eta import get_predictor
from app.services.notifications import format_rupiah
from app.services.orders import (
    PAYMENT_LABEL,
    STATUS_LABEL,
    EtaContext,
    _order_items,
    generate_tracking_code,
    predict_eta,
    promised_ready_at,
    recompute_etas,
)
from gedklin_ml.features import LOCAL_TZ, shift_into_open_hours

DAYS = 60
MOBILE_PREFIX = "62812990"
LANDLINE_PREFIX = "6261990"
DEMO_PASSWORD = "kasir123"
CASHIERS = [("Rina Sitompul", "rina"), ("Dedi Siregar", "dedi")]

FIRST = (
    "Andi Budi Citra Dewi Eka Fajar Gita Hendra Indah Joko Kartika Lestari Maya Nanda Oki Putri "
    "Rizky Sari Tono Utami Vina Wahyu Yusuf Zahra Aldi Bella Cahya Dimas Elsa Farhan Gilang "
    "Hana Irfan Jihan Kevin Lia Mega Nisa Rendi Siska Taufik Ulfa Wulan Yoga Rahmat Fitri"
).split()
LAST = (
    "Siregar Nasution Lubis Harahap Simanjuntak Sitorus Panjaitan Tarigan Ginting Sembiring "
    "Hutapea Manurung Pohan Daulay Batubara Damanik Saragih Purba Hasibuan Rangkuti"
).split()
CANCEL_REASONS = ("Pelanggan batal", "Salah input berat", "Pakaian dibawa pulang lagi")
NOTES = ("Pisahkan pakaian putih", "Jangan pakai pewangi", "Lipat rapi", "Ada noda di kemeja")

# (bobot, item pembentuk pesanan)
TEMPLATES: list[tuple[int, str]] = [
    (34, "CKL"),
    (24, "CKS"),
    (12, "CK"),
    (5, "C"),
    (7, "SETRIKA"),
    (6, "KHUSUS"),
    (7, "SATUAN"),
    (5, "CAMPUR"),
]
KHUSUS = ["BEDCOVER_K", "BEDCOVER_B", "JAKET", "SELIMUT_K", "SPREI_K", "GORDYN"]
SATUAN = ["KEMEJA_PANJANG", "KEMEJA_PENDEK", "CELANA_BAHAN", "GAMIS_RINGAN", "KHIMAR_M", "BONEKA_M"]


def _items(rng: random.Random) -> tuple[list[pricing.ItemRequest], bool]:
    kind = rng.choices([t for _, t in TEMPLATES], [w for w, _ in TEMPLATES])[0]

    def kg(lo: float, hi: float) -> float:
        return round(rng.uniform(lo, hi), 1)

    def piece(code: str) -> pricing.ItemRequest:
        if code == "GORDYN":
            return pricing.ItemRequest(code, weight_kg=kg(5, 8))
        if code.startswith("SPREI"):
            return pricing.ItemRequest(code, weight_kg=kg(2, 6))
        return pricing.ItemRequest(code, qty_pcs=rng.randint(1, 3))

    if kind in ("CKL", "CKS", "CK", "C"):
        items = [pricing.ItemRequest(kind, weight_kg=kg(3, 12))]
        if rng.random() < 0.15:
            items.append(piece(rng.choice(KHUSUS[:3])))
        express = kind in ("CKL", "CKS") and rng.random() < 0.16
        return items, express
    if kind == "SETRIKA":
        return [pricing.ItemRequest("SETRIKA", weight_kg=kg(5, 10))], False
    if kind == "KHUSUS":
        return [piece(c) for c in rng.sample(KHUSUS, rng.randint(1, 2))], False
    if kind == "SATUAN":
        return [
            pricing.ItemRequest(c, qty_pcs=rng.randint(1, 4)) for c in rng.sample(SATUAN, 2)
        ], False
    return [
        pricing.ItemRequest("CKS", weight_kg=kg(4, 8)),
        pricing.ItemRequest(rng.choice(SATUAN), qty_pcs=rng.randint(1, 3)),
    ], False


def _local(day: date, minutes: float) -> datetime:
    return datetime.combine(day, time(8, 0), tzinfo=LOCAL_TZ) + timedelta(minutes=minutes)


def _customers(db: Session, rng: random.Random) -> list[Customer]:
    existing = list(db.scalars(select(Customer).where(_demo_customer())))
    if existing:
        return existing
    customers = []
    names = {f"{f} {last}" for f in FIRST for last in LAST}
    for i, name in enumerate(rng.sample(sorted(names), 130)):
        has_wa = rng.random() > 0.07
        phone = f"{MOBILE_PREFIX}{i:05d}" if has_wa else f"{LANDLINE_PREFIX}{i:04d}"
        c = Customer(name=name, phone_wa=phone, has_whatsapp=has_wa)
        c.created_at = utcnow() - timedelta(days=DAYS + 5)
        customers.append(c)
    db.add_all(customers)
    db.flush()
    return customers


def _demo_customer():  # noqa: ANN202
    return or_(
        Customer.phone_wa.startswith(MOBILE_PREFIX), Customer.phone_wa.startswith(LANDLINE_PREFIX)
    )


def _staff(db: Session) -> list[User]:
    staff = []
    for name, username in CASHIERS:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            user = User(
                name=name,
                username=username,
                password_hash=hash_password(DEMO_PASSWORD),
                role=Role.CASHIER,
                is_active=True,
            )
            db.add(user)
        staff.append(user)
    db.flush()
    owner = db.scalar(select(User).where(User.role == Role.OWNER))
    others = list(
        db.scalars(select(User).where(User.role == Role.CASHIER, User.is_active.is_(True)))
    )
    return list({u.id: u for u in [*staff, *others, *([owner] if owner else [])]}.values())


def _daily_operations(db: Session, rng: random.Random, today: date) -> None:
    for offset in range(DAYS, -2, -1):
        day = today - timedelta(days=offset)
        if db.scalar(select(DailyOperation.id).where(DailyOperation.date == day)):
            continue
        broken = rng.random() < 0.08
        db.add(
            DailyOperation(
                date=day,
                is_open=True,
                staff_on_duty=3 if day.weekday() >= 5 else rng.choice((2, 2, 3)),
                washers_available=3 if broken else 4,
                dryers_available=3,
                open_time=time(8, 0),
                close_time=time(20, 0) if day.weekday() >= 5 else time(19, 0),
                machine_issue_note="Mesin cuci 2 diservis" if broken else None,
            )
        )
    db.flush()


def _log(db: Session, user: User | None, action: str, summary: str, code: str, at: datetime):
    # Ditampung dulu: halaman log mengurutkan per id, jadi baru ditulis urut waktu di akhir seed.
    db.info.setdefault("demo_logs", []).append(
        ActivityLog(
            user_id=user.id if user else None,
            action=action,
            entity_type="order",
            entity_id=code,
            summary=summary[:255],
            created_at=at,
        )
    )


def _notify(db: Session, order: Order, kind: NotificationType, at: datetime, rng: random.Random):
    failed = rng.random() < 0.03
    db.add(
        Notification(
            order_id=order.id,
            type=kind,
            status=NotificationStatus.FAILED if failed else NotificationStatus.SENT,
            sent_at=None if failed else at + timedelta(seconds=rng.randint(5, 90)),
            error="Nomor tidak terdaftar di WhatsApp" if failed else None,
            created_at=at,
        )
    )


def _history(db: Session, order: Order, steps: list[tuple[OrderStatus, datetime, User | None]]):
    prev: OrderStatus | None = None
    for to, at, user in steps:
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=prev,
                to_status=to,
                changed_at=at,
                changed_by=user.id if user else None,
            )
        )
        if prev is not None:
            _log(
                db,
                user,
                "order.status",
                f"Mengubah status {order.tracking_code} ({order.customer.name}) "
                f"menjadi {STATUS_LABEL[to]}",
                order.tracking_code,
                at,
            )
        prev = to


def seed_demo(db: Session, seed: int = 7) -> int:
    rng = random.Random(seed)
    now = utcnow()
    today = now.astimezone(LOCAL_TZ).date()
    staff = _staff(db)
    customers = _customers(db, rng)
    regulars = customers[:35]
    _daily_operations(db, rng, today)
    config = load_app_config(db)
    ctx = EtaContext.load(db)
    model_version = get_predictor().model_version
    methods = [PaymentMethod.CASH, PaymentMethod.QRIS, PaymentMethod.TRANSFER]
    racks = [f"{r}-{n:02d}" for r in "ABCD" for n in range(1, 13)]
    created = 0

    for offset in range(DAYS, -1, -1):
        day = today - timedelta(days=offset)
        growth = 1 + (DAYS - offset) / DAYS * 0.35
        base = 21 if day.weekday() >= 5 else 15
        count = max(6, int(rng.gauss(base * growth, 3)))
        open_minutes = 11 * 60 if day.weekday() >= 5 else 10 * 60
        times = sorted(rng.uniform(0, open_minutes) for _ in range(count))
        if offset == 0:
            elapsed = (now.astimezone(LOCAL_TZ) - _local(day, 0)).total_seconds() / 60
            times = [t for t in times if t < elapsed - 5][: max(4, int(count * 0.4))]

        for minutes in times:
            received = _local(day, minutes).astimezone(UTC)
            requests, express = _items(rng)
            quote = pricing.quote(
                db,
                requests,
                is_express=express,
                express_multiplier=config.express_multiplier,
                machine_capacity_kg=config.machine_capacity_kg,
            )
            customer = rng.choice(regulars) if rng.random() < 0.45 else rng.choice(customers)
            cashier = rng.choice(staff)
            pay_now = rng.random() < 0.55
            method = rng.choices(methods, [50, 35, 15])[0]
            order = Order(
                tracking_code=generate_tracking_code(db),
                customer=customer,
                is_express=express,
                price_total=quote.total,
                received_at=received,
                status=OrderStatus.RECEIVED,
                delay_notif_count=0,
                ready_notif_sent=False,
                needs_followup=False,
                created_by=cashier.id,
                notes=rng.choice(NOTES) if rng.random() < 0.12 else None,
                payment_method=method if pay_now else None,
                paid_at=received if pay_now else None,
                items=_order_items(quote),
            )
            order.creator = cashier
            db.add(order)
            db.flush()
            order.promised_ready_at = promised_ready_at(order, ctx)
            _log(
                db,
                cashier,
                "order.create",
                f"Menerima pesanan {order.tracking_code} dari {customer.name} "
                f"({format_rupiah(order.price_total)}{', Express' if express else ''}"
                f"{f', lunas {PAYMENT_LABEL[method]}' if pay_now else ''})",
                order.tracking_code,
                received,
            )
            if customer.has_whatsapp:
                _notify(db, order, NotificationType.RECEIPT, received, rng)
            created += 1

            # Durasi nyata: umumnya sebelum janji, sebagian kecil terlambat.
            window = order.promised_ready_at - received
            factor = rng.uniform(1.03, 1.35) if rng.random() < 0.09 else rng.uniform(0.55, 0.98)
            ready = shift_into_open_hours(received + window * factor, ctx.day_ops)
            steps: list[tuple[OrderStatus, datetime, User | None]] = [
                (OrderStatus.RECEIVED, received, cashier)
            ]
            processing = received + timedelta(minutes=rng.randint(20, 150))

            if rng.random() < 0.02 and processing < now:
                order.status = OrderStatus.CANCELLED
                order.cancelled_at = processing
                order.cancel_reason = rng.choice(CANCEL_REASONS)
                order.payment_method = order.paid_at = None
                db.add(
                    OrderStatusHistory(
                        order_id=order.id,
                        from_status=OrderStatus.RECEIVED,
                        to_status=OrderStatus.CANCELLED,
                        changed_at=processing,
                        changed_by=cashier.id,
                    )
                )
                _history(db, order, steps)
                _log(
                    db,
                    cashier,
                    "order.cancel",
                    f"Membatalkan pesanan {order.tracking_code} ({customer.name}): "
                    f"{order.cancel_reason}",
                    order.tracking_code,
                    processing,
                )
                continue

            if ready > now:
                # Masih di antrean: ETA dihitung model seperti pesanan sungguhan.
                if processing < now:
                    order.status = OrderStatus.PROCESSING
                    steps.append((OrderStatus.PROCESSING, processing, rng.choice(staff)))
                _history(db, order, steps)
                eta = predict_eta(db, order, ctx)
                order.initial_predicted_ready_at = order.last_notified_eta = eta
                continue

            initial = shift_into_open_hours(ready + timedelta(hours=rng.gauss(0, 2.2)), ctx.day_ops)
            order.initial_predicted_ready_at = order.predicted_ready_at = initial
            order.last_notified_eta = initial
            db.add(
                PredictionLog(
                    order_id=order.id,
                    features_json={},
                    predicted_hours=round((initial - received) / timedelta(hours=1), 3),
                    model_version=model_version,
                    created_at=received,
                )
            )
            if ready > initial + timedelta(hours=6) and customer.has_whatsapp:
                order.delay_notif_count = 1
                _notify(db, order, NotificationType.DELAY, initial - timedelta(hours=3), rng)
            order.status = OrderStatus.READY
            order.ready_at = ready
            order.rack_location = rng.choice(racks)
            steps.append((OrderStatus.PROCESSING, processing, rng.choice(staff)))
            steps.append((OrderStatus.READY, ready, rng.choice(staff)))
            if customer.has_whatsapp:
                _notify(db, order, NotificationType.READY, ready, rng)
                order.ready_notif_sent = True

            pickup = shift_into_open_hours(
                ready + timedelta(hours=rng.expovariate(1 / 22)), ctx.day_ops
            )
            forgotten = offset > 4 and rng.random() < 0.012
            if pickup > now or forgotten:
                order.needs_followup = ready < now - timedelta(days=3)
                _history(db, order, steps)
                continue
            pickup_by = rng.choice(staff)
            if not order.paid_at:
                order.payment_method = method
                order.paid_at = pickup
                _log(
                    db,
                    pickup_by,
                    "order.payment",
                    f"Mencatat pembayaran {order.tracking_code} ({customer.name}) "
                    f"{format_rupiah(order.price_total)} via {PAYMENT_LABEL[method]}",
                    order.tracking_code,
                    pickup,
                )
            order.status = OrderStatus.PICKED_UP
            order.picked_up_at = pickup
            steps.append((OrderStatus.PICKED_UP, pickup, pickup_by))
            _history(db, order, steps)

        db.flush()
    db.add_all(sorted(db.info.pop("demo_logs", []), key=lambda log: log.created_at))
    db.commit()
    recompute_etas(db, now)
    return created


def remove_demo(db: Session) -> int:
    ids = list(db.scalars(select(Order.id).join(Customer).where(_demo_customer())))
    codes = list(db.scalars(select(Order.tracking_code).where(Order.id.in_(ids))))
    for model in (Notification, PredictionLog, OrderStatusHistory, OrderItem):
        db.execute(delete(model).where(model.order_id.in_(ids)))
    db.execute(delete(ActivityLog).where(ActivityLog.entity_id.in_(codes)))
    db.execute(delete(Order).where(Order.id.in_(ids)))
    db.execute(delete(Customer).where(_demo_customer()))
    db.commit()
    return len(ids)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hapus", action="store_true", help="hapus semua data contoh")
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.hapus:
            print(f"{remove_demo(db)} pesanan contoh dihapus")
            return
        if db.scalar(select(Customer.id).where(_demo_customer()).limit(1)):
            raise SystemExit("Data contoh sudah ada. Hapus dulu dengan --hapus")
        n = seed_demo(db)
        print(
            f"{n} pesanan contoh dibuat. Login kasir contoh: rina / dedi, password {DEMO_PASSWORD}"
        )


if __name__ == "__main__":
    main()
