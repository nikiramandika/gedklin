"""Penjadwalan antrean cucian dengan Least Slack Time (LST).

slack = sisa jam kerja sampai janji siap - taksiran waktu proses pesanan

Waktu proses ditaksir dari berat: berat -> jumlah load mesin -> siklus cuci/kering yang bisa
berjalan paralel di beberapa mesin, ditambah setrika manual per kg/pcs oleh petugas yang
bertugas. Slack terkecil dikerjakan duluan, jadi pesanan berat yang janjinya sudah dekat naik
ke atas, sedangkan pesanan ringan yang janjinya masih jauh boleh menunggu. Express tidak diberi
jalur khusus: janjinya yang pendek otomatis membuat slack-nya kecil.

Mencuci tidak bisa disela di tengah siklus (non-preemptive), jadi pesanan yang sudah diproses
selalu tetap di depan dan tidak disalip pesanan baru.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import ACTIVE_STATUSES, Order, OrderStatus
from app.services.app_settings import day_ops_lookup, load_app_config
from app.services.operations import (
    DRYER_PROCESSES,
    IRONING_PROCESSES,
    DayOps,
    DayOpsLookup,
    WorkRates,
    local_date,
    work_hours_between,
)


class ItemLike(Protocol):
    process: str
    weight_kg: float | None
    qty_pcs: int | None
    machine_loads: int | None


def processing_hours(items: Iterable[ItemLike], day: DayOps, rates: WorkRates) -> float:
    wash_loads = dry_loads = 0
    iron_minutes = 0.0
    for item in items:
        process = str(item.process)
        loads = int(item.machine_loads or 0)
        wash_loads += loads
        if process in DRYER_PROCESSES:
            dry_loads += loads
        if process in IRONING_PROCESSES:
            if item.weight_kg:
                iron_minutes += float(item.weight_kg) * rates.iron_minutes_per_kg
            else:
                iron_minutes += int(item.qty_pcs or 0) * rates.iron_minutes_per_pcs
    # Load dibagi ke mesin yang tersedia; mesin rusak semua (0) dianggap 1 agar tidak membagi 0.
    wash = math.ceil(wash_loads / max(day.washers_available, 1)) * rates.wash_minutes_per_load
    dry = math.ceil(dry_loads / max(day.dryers_available, 1)) * rates.dry_minutes_per_load
    iron = iron_minutes / max(day.staff_on_duty, 1)
    return (wash + dry + iron) / 60


def hours_until(deadline: datetime, now: datetime, day_ops: DayOpsLookup) -> float:
    """Sisa jam kerja sampai deadline; negatif bila sudah lewat."""
    if deadline >= now:
        return work_hours_between(now, deadline, day_ops)
    return -work_hours_between(deadline, now, day_ops)


@dataclass(frozen=True)
class ScheduledOrder:
    order: Order
    processing_hours: float
    # None = pesanan lama tanpa janji, ditaruh paling belakang.
    slack_hours: float | None

    @property
    def started(self) -> bool:
        return self.order.status == OrderStatus.PROCESSING

    def rank(self) -> tuple[int, float, datetime, int]:
        slack = math.inf if self.slack_hours is None else self.slack_hours
        return (0 if self.started else 1, slack, self.order.received_at, self.order.id)


def schedule_order(
    order: Order, now: datetime, day_ops: DayOpsLookup, rates: WorkRates
) -> ScheduledOrder:
    hours = processing_hours(order.items, day_ops(local_date(now)), rates)
    slack = None
    if order.promised_ready_at is not None:
        slack = hours_until(order.promised_ready_at, now, day_ops) - hours
    return ScheduledOrder(order, round(hours, 2), None if slack is None else round(slack, 2))


def schedule(
    orders: Iterable[Order], now: datetime, day_ops: DayOpsLookup, rates: WorkRates
) -> list[ScheduledOrder]:
    return sorted((schedule_order(o, now, day_ops, rates) for o in orders), key=ScheduledOrder.rank)


def active_schedule(db: Session, now: datetime | None = None) -> list[ScheduledOrder]:
    now = now or utcnow()
    config = load_app_config(db)
    orders = db.scalars(select(Order).where(Order.status.in_(ACTIVE_STATUSES)))
    return schedule(orders, now, day_ops_lookup(db, config), config.work_rates)


def active_orders(db: Session, now: datetime | None = None) -> list[Order]:
    return [s.order for s in active_schedule(db, now)]
