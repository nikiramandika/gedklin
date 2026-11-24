"""Skenario antrean untuk demo penjadwalan (Least Slack Time).

Menambah beberapa pesanan "Belum diproses" dengan berat dan janji yang diatur relatif terhadap
waktu sekarang, supaya di papan kasir dan layar Antrean Cucian terlihat:
- cucian berat yang janjinya dekat naik di atas cucian ringan yang janjinya lebih awal;
- badge "Segera" pada pesanan yang sisa waktunya tinggal sedikit;
- pesanan yang masih longgar tetap di bawah.

    python -m app.seed_antrean            # tambah skenario (menghapus skenario lama dulu)
    python -m app.seed_antrean --hapus    # hapus skenario

Pelanggan memakai nomor demo 6281299088xxx, jadi ikut terhapus oleh `seed_demo --hapus` dan
tidak tercampur dengan data asli. Tidak ada WA yang dikirim. Jangan dijalankan di production.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, utcnow
from app.models import (
    ActivityLog,
    Customer,
    Notification,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
)
from app.services import pricing
from app.services.app_settings import day_ops_lookup, load_app_config
from app.services.operations import LOCAL_TZ, DayOpsLookup, to_local
from app.services.orders import (
    PromiseContext,
    _order_items,
    generate_tracking_code,
    order_promised_hours,
)

PHONE_PREFIX = "6281299088"


@dataclass(frozen=True)
class Case:
    name: str
    items: list[pricing.ItemRequest]
    express: bool
    # Sisa jam kerja sampai janji, dihitung dari sekarang.
    work_hours_left: float


# Taksiran lama kerja memakai pengaturan bawaan (4 mesin cuci, 3 pengering, 2 petugas,
# 60/60 menit per load, setrika 10 menit/kg, 5 menit/pcs).
CASES = [
    # ±4 jam kerja, sisa 4,5 jam -> slack 0,5: paling atas walau janji Rina lebih awal.
    Case("Budi Santoso", [pricing.ItemRequest("CKS", weight_kg=24)], True, 4.5),
    # ±2 jam kerja, sisa 3 jam -> slack 1.
    Case("Rina Marpaung", [pricing.ItemRequest("CKL", weight_kg=4)], True, 3),
    # ±2,8 jam kerja, sisa 6 jam -> slack 3,2: masih "Segera".
    Case("Tono Sihombing", [pricing.ItemRequest("CKS", weight_kg=10)], False, 6),
    # ±2 jam kerja, sisa 9 jam -> longgar.
    Case("Sari Lubis", [pricing.ItemRequest("CKL", weight_kg=6)], False, 9),
    # ±2 jam kerja, sisa 14 jam.
    Case("Dewi Purba", [pricing.ItemRequest("CK", weight_kg=15)], False, 14),
    # Satuan, ±10 menit, sisa 20 jam.
    Case(
        "Joko Tarigan",
        [
            pricing.ItemRequest("KEMEJA_PANJANG", qty_pcs=3),
            pricing.ItemRequest("CELANA_BAHAN", qty_pcs=1),
        ],
        False,
        20,
    ),
    # ±2 jam kerja, sisa 30 jam -> paling bawah.
    Case("Lina Ginting", [pricing.ItemRequest("CKL", weight_kg=8)], False, 30),
]


def add_work_hours(
    start: datetime, hours: float, day_ops: DayOpsLookup, max_days: int = 30
) -> datetime:
    """Waktu setelah `hours` jam buka outlet dari `start`; malam dan hari tutup dilewati."""
    local = to_local(start)
    remaining = timedelta(hours=hours)
    for _ in range(max_days):
        ops = day_ops(local.date())
        if ops.is_open:
            open_dt = datetime.combine(local.date(), ops.open_time, tzinfo=LOCAL_TZ)
            close_dt = datetime.combine(local.date(), ops.close_time, tzinfo=LOCAL_TZ)
            cursor = max(local, open_dt)
            if cursor < close_dt:
                if cursor + remaining <= close_dt:
                    return (cursor + remaining).astimezone(UTC)
                remaining -= close_dt - cursor
        local = datetime.combine(local.date() + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
    return (local + remaining).astimezone(UTC)


def _scenario_customers() -> object:
    return Customer.phone_wa.like(f"{PHONE_PREFIX}%")


def remove_scenario(db: Session) -> int:
    ids = list(db.scalars(select(Order.id).join(Customer).where(_scenario_customers())))
    codes = list(db.scalars(select(Order.tracking_code).where(Order.id.in_(ids))))
    for model in (Notification, OrderStatusHistory, OrderItem):
        db.execute(delete(model).where(model.order_id.in_(ids)))
    db.execute(delete(ActivityLog).where(ActivityLog.entity_id.in_(codes)))
    db.execute(delete(Order).where(Order.id.in_(ids)))
    db.execute(delete(Customer).where(_scenario_customers()))
    db.commit()
    return len(ids)


def seed_scenario(db: Session, now: datetime | None = None) -> list[Order]:
    remove_scenario(db)
    now = now or utcnow()
    config = load_app_config(db)
    day_ops = day_ops_lookup(db, config)
    ctx = PromiseContext.load(db)
    orders = []
    for i, case in enumerate(CASES, start=1):
        quote = pricing.quote(
            db,
            case.items,
            is_express=case.express,
            express_multiplier=config.express_multiplier,
            machine_capacity_kg=config.machine_capacity_kg,
        )
        customer = Customer(name=case.name, phone_wa=f"{PHONE_PREFIX}{i:03d}", has_whatsapp=True)
        db.add(customer)
        order = Order(
            tracking_code=generate_tracking_code(db),
            customer=customer,
            is_express=case.express,
            price_total=quote.total,
            received_at=now,
            status=OrderStatus.RECEIVED,
            ready_notif_sent=False,
            needs_followup=False,
            items=_order_items(quote),
        )
        db.add(order)
        db.flush()
        # Janji diatur supaya sisa waktunya sesuai skenario; waktu terima dimundurkan sesuai
        # lama janji layanan supaya pasangan "diterima → janji" tetap masuk akal.
        promise = add_work_hours(now, case.work_hours_left, day_ops)
        order.promised_ready_at = promise
        order.received_at = min(now, promise - timedelta(hours=order_promised_hours(order, ctx)))
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=None,
                to_status=OrderStatus.RECEIVED,
                changed_at=order.received_at,
            )
        )
        orders.append(order)
    db.commit()
    return orders


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hapus", action="store_true", help="hapus skenario antrean")
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.hapus:
            print(f"Skenario dihapus: {remove_scenario(db)} pesanan")
            return
        orders = seed_scenario(db)
        print(f"Skenario ditambahkan: {len(orders)} pesanan Belum diproses")
        for o in orders:
            promise = to_local(o.promised_ready_at)
            print(f"  {o.tracking_code}  {o.customer.name:<16} janji {promise:%d/%m %H:%M}")


if __name__ == "__main__":
    main()
