"""Penjadwalan antrean cucian: Least Slack Time (LST) + simulasi sumber daya paralel.

1. Prioritas (LST)
   slack = sisa jam kerja sampai janji siap - taksiran waktu proses pesanan

   Waktu proses memakai lama kerja dari katalog (ketetapan mitra) apa adanya, tidak dibagi ke
   petugas: dikali jumlah (kemeja 1 jam/pcs), atau sekali per pesanan untuk layanan yang
   waktunya tidak bergantung jumlah (gordyn 2 hari). Kiloan "per 7 kg" dihitung per putaran
   mesin: load pesanan dibagi ke mesin cuci yang tersedia, jadi 24 kg (3 load) dengan 4 mesin
   tetap 1 putaran, tapi bila mesin tinggal 2 menjadi 2 putaran.
   Layanan tanpa lama kerja ditaksir dari berat: jumlah load -> siklus cuci/kering di mesin yang
   tersedia, ditambah setrika manual per kg/pcs yang dibagi ke petugas yang bertugas.

   Slack terkecil dikerjakan duluan, jadi pesanan berat yang janjinya sudah dekat naik ke atas,
   sedangkan pesanan ringan yang janjinya masih jauh boleh menunggu. Express tidak diberi jalur
   khusus: janjinya yang pendek otomatis membuat slack-nya kecil.

   Mencuci tidak bisa disela di tengah siklus (non-preemptive), jadi pesanan yang sudah
   diproses selalu tetap di depan dan tidak disalip pesanan baru.

2. Perkiraan siap (list scheduling)
   Slack menilai tiap pesanan seolah dikerjakan sendirian. Padahal mesin dan petugas dipakai
   bergantian oleh semua pesanan, jadi pesanan di urutan bawah harus menunggu. Simulasi
   membagikan pekerjaan sesuai urutan LST ke sumber daya yang paling cepat kosong:
   - tiap load dicuci di mesin cuci yang paling cepat kosong, lalu dikeringkan di pengering
     yang paling cepat kosong (load pesanan lain bisa jalan di mesin lain pada saat yang sama);
   - kerja tangan dimulai setelah semua load pesanan itu selesai, dibagi ke semua petugas yang
     sedang kosong saat itu. Bila semua kosong, mereka mengerjakannya bersama sehingga pesanan
     paling mendesak selesai lebih cepat; bila sebagian masih sibuk, petugas yang kosong
     memegang pesanan berikutnya sendiri, jadi dua pesanan berjalan paralel.
   Hasilnya perkiraan mulai dan siap tiap pesanan, serta perkiraan telat bila melewati janji.
   Jumlah mesin dan petugas memakai data hari ini untuk seluruh simulasi.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import utcnow
from app.models import ACTIVE_STATUSES, CatalogUnit, Order, OrderStatus, ServiceCatalog
from app.services.app_settings import day_ops_lookup, load_app_config
from app.services.operations import (
    DRYER_PROCESSES,
    IRONING_PROCESSES,
    DayOps,
    DayOpsLookup,
    WorkRates,
    add_work_hours,
    local_date,
    subtract_work_hours,
    work_hours_between,
)


class ItemLike(Protocol):
    catalog_code: str
    process: str
    weight_kg: float | None
    qty_pcs: int | None
    machine_loads: int | None


@dataclass(frozen=True)
class ItemWork:
    """Lama kerja dari katalog: menit per satuan harga, atau per pesanan."""

    unit: CatalogUnit
    minutes: float
    per_order: bool = False

    def total_minutes(self, item: ItemLike, washers: int = 1) -> float:
        if self.per_order:
            return self.minutes
        if self.unit == CatalogUnit.KILOAN_7KG:
            # Per putaran mesin: load berjalan bersamaan di mesin yang tersedia.
            return math.ceil(max(int(item.machine_loads or 0), 1) / max(washers, 1)) * self.minutes
        if self.unit == CatalogUnit.LOAD:
            qty = float(item.machine_loads or 0)
        elif self.unit == CatalogUnit.PCS:
            qty = float(item.qty_pcs or 0)
        else:
            qty = float(item.weight_kg or 0)
        return qty * self.minutes


@dataclass(frozen=True)
class WorkParts:
    """Pekerjaan satu pesanan, dipisah per sumber daya."""

    wash_loads: int = 0
    dry_loads: int = 0
    # Setrika manual, dibagi ke petugas yang bertugas (menit untuk satu petugas).
    iron_minutes: float = 0.0
    # Lama kerja dari katalog, dipakai apa adanya (menit).
    catalog_minutes: float = 0.0

    @property
    def hand_minutes(self) -> float:
        return self.iron_minutes + self.catalog_minutes

    def hand_time(self, staff: int) -> float:
        """Menit kerja tangan: setrika dibagi petugas, lama kerja katalog tetap."""
        return self.iron_minutes / max(staff, 1) + self.catalog_minutes


def work_parts(
    items: Iterable[ItemLike],
    rates: WorkRates,
    item_work: Mapping[str, ItemWork] | None = None,
    washers: int = 1,
) -> WorkParts:
    wash_loads = dry_loads = 0
    iron = catalog = 0.0
    for item in items:
        work = (item_work or {}).get(item.catalog_code)
        if work is not None:
            catalog += work.total_minutes(item, washers)
            continue
        process = str(item.process)
        loads = int(item.machine_loads or 0)
        wash_loads += loads
        if process in DRYER_PROCESSES:
            dry_loads += loads
        if process in IRONING_PROCESSES:
            if item.weight_kg:
                iron += float(item.weight_kg) * rates.iron_minutes_per_kg
            else:
                iron += int(item.qty_pcs or 0) * rates.iron_minutes_per_pcs
    return WorkParts(wash_loads, dry_loads, iron, catalog)


def processing_hours(
    items: Iterable[ItemLike],
    day: DayOps,
    rates: WorkRates,
    item_work: Mapping[str, ItemWork] | None = None,
) -> float:
    """Lama kerja bila pesanan ini dikerjakan sendirian dengan semua mesin dan petugas."""
    parts = work_parts(items, rates, item_work, day.washers_available)
    # Load dibagi ke mesin yang tersedia; mesin rusak semua (0) dianggap 1 agar tidak membagi 0.
    washers = max(day.washers_available, 1)
    dryers = max(day.dryers_available, 1)
    wash = math.ceil(parts.wash_loads / washers) * rates.wash_minutes_per_load
    dry = math.ceil(parts.dry_loads / dryers) * rates.dry_minutes_per_load
    hand = parts.hand_time(day.staff_on_duty)
    return (wash + dry + hand) / 60


def load_item_work(db: Session) -> dict[str, ItemWork]:
    rows = db.execute(
        select(
            ServiceCatalog.code,
            ServiceCatalog.unit,
            ServiceCatalog.work_minutes,
            ServiceCatalog.work_per_order,
        ).where(ServiceCatalog.work_minutes.is_not(None))
    )
    return {code: ItemWork(unit, minutes, per_order) for code, unit, minutes, per_order in rows}


def hours_until(deadline: datetime, now: datetime, day_ops: DayOpsLookup) -> float:
    """Sisa jam kerja sampai deadline; negatif bila sudah lewat."""
    if deadline >= now:
        return work_hours_between(now, deadline, day_ops)
    return -work_hours_between(deadline, now, day_ops)


@dataclass(frozen=True)
class Forecast:
    """Hasil simulasi untuk satu pesanan. start/ready dalam jam kerja dari sekarang."""

    start: float
    ready: float
    # Jumlah petugas yang mengerjakan kerja tangannya (0 bila tidak ada kerja tangan).
    staff: int
    start_at: datetime
    ready_at: datetime
    # Perkiraan telat dari janji dalam jam kerja; 0 = tepat waktu, None = tanpa janji.
    late_hours: float | None


@dataclass(frozen=True)
class ScheduledOrder:
    order: Order
    processing_hours: float
    # None = pesanan lama tanpa janji, ditaruh paling belakang.
    slack_hours: float | None
    # Batas paling lambat mulai dikerjakan agar selesai tepat janji (janji - lama kerja, jam kerja).
    latest_start_at: datetime | None = None
    parts: WorkParts = field(default_factory=WorkParts)
    forecast: Forecast | None = None

    @property
    def started(self) -> bool:
        return self.order.status == OrderStatus.PROCESSING

    def rank(self) -> tuple[int, float, datetime, int]:
        slack = math.inf if self.slack_hours is None else self.slack_hours
        return (0 if self.started else 1, slack, self.order.received_at, self.order.id)


def started_at(order: Order) -> datetime | None:
    times = [h.changed_at for h in order.history if h.to_status == OrderStatus.PROCESSING]
    return max(times) if times else None


def schedule_order(
    order: Order,
    now: datetime,
    day_ops: DayOpsLookup,
    rates: WorkRates,
    item_work: Mapping[str, ItemWork] | None = None,
) -> ScheduledOrder:
    day = day_ops(local_date(now))
    hours = processing_hours(order.items, day, rates, item_work)
    slack = latest_start = None
    if order.promised_ready_at is not None:
        slack = hours_until(order.promised_ready_at, now, day_ops) - hours
        latest_start = subtract_work_hours(order.promised_ready_at, hours, day_ops)
    return ScheduledOrder(
        order,
        round(hours, 2),
        None if slack is None else round(slack, 2),
        latest_start,
        work_parts(order.items, rates, item_work, day.washers_available),
    )


def _take(pool: list[float], ready: float, minutes: float) -> tuple[float, float]:
    """Pakai sumber daya yang paling cepat kosong; kembalikan (mulai, selesai) dalam jam."""
    i = min(range(len(pool)), key=pool.__getitem__)
    start = max(pool[i], ready)
    pool[i] = start + minutes / 60
    return start, pool[i]


def _at(now: datetime, hours: float, day_ops: DayOpsLookup) -> datetime:
    if hours >= 0:
        return add_work_hours(now, hours, day_ops)
    return subtract_work_hours(now, -hours, day_ops)


def simulate(
    entries: list[ScheduledOrder], now: datetime, day_ops: DayOpsLookup, rates: WorkRates
) -> list[ScheduledOrder]:
    """List scheduling: bagikan pekerjaan sesuai urutan LST ke mesin dan petugas paralel."""
    day = day_ops(local_date(now))
    # Waktu kosong tiap sumber daya, jam kerja dari sekarang. -inf = sudah kosong sejak tadi,
    # supaya pesanan yang mulai sebelum sekarang bisa dihitung dari waktu mulainya.
    washers = [-math.inf] * max(day.washers_available, 1)
    dryers = [-math.inf] * max(day.dryers_available, 1)
    staff = [-math.inf] * max(day.staff_on_duty, 1)

    out: list[ScheduledOrder] = []
    for entry in entries:
        release = 0.0
        begun = started_at(entry.order) if entry.started else None
        if begun is not None:
            release = -work_hours_between(begun, now, day_ops)
        parts = entry.parts
        first = math.inf
        machine_done = release
        for load in range(parts.wash_loads):
            start, done = _take(washers, release, rates.wash_minutes_per_load)
            first = min(first, start)
            if load < parts.dry_loads:
                _, done = _take(dryers, done, rates.dry_minutes_per_load)
            machine_done = max(machine_done, done)

        ready = machine_done
        helpers = 0
        if parts.hand_minutes > 0:
            # Mulai saat cucian siap dan ada petugas kosong; semua petugas yang kosong pada saat
            # itu ikut membantu.
            start = max(machine_done, min(staff))
            free = [i for i, t in enumerate(staff) if t <= start]
            ready = start + parts.hand_time(len(free)) / 60
            for i in free:
                staff[i] = ready
            first = min(first, start)
            helpers = len(free)
        if first == math.inf:
            first = release

        # Pesanan yang sudah berjalan lebih lama dari taksiran dianggap siap sekarang.
        ready = max(ready, 0.0)
        late = None
        if entry.order.promised_ready_at is not None:
            late = max(0.0, ready - hours_until(entry.order.promised_ready_at, now, day_ops))
        forecast = Forecast(
            start=round(first, 2),
            ready=round(ready, 2),
            staff=helpers,
            start_at=_at(now, first, day_ops),
            ready_at=_at(now, ready, day_ops),
            late_hours=None if late is None else round(late, 2),
        )
        out.append(replace(entry, forecast=forecast))
    return out


def forecast_fields(entry: ScheduledOrder) -> dict[str, object]:
    """Kolom est_* untuk respons API."""
    f = entry.forecast
    if f is None:
        return {
            "est_start_at": None,
            "est_ready_at": None,
            "est_late_hours": None,
            "est_staff": None,
        }
    return {
        "est_start_at": f.start_at,
        "est_ready_at": f.ready_at,
        "est_late_hours": f.late_hours,
        "est_staff": f.staff,
    }


def schedule(
    orders: Iterable[Order],
    now: datetime,
    day_ops: DayOpsLookup,
    rates: WorkRates,
    item_work: Mapping[str, ItemWork] | None = None,
) -> list[ScheduledOrder]:
    entries = sorted(
        (schedule_order(o, now, day_ops, rates, item_work) for o in orders),
        key=ScheduledOrder.rank,
    )
    return simulate(entries, now, day_ops, rates)


def active_schedule(db: Session, now: datetime | None = None) -> list[ScheduledOrder]:
    now = now or utcnow()
    config = load_app_config(db)
    orders = db.scalars(
        select(Order)
        .where(Order.status.in_(ACTIVE_STATUSES))
        .options(selectinload(Order.items), selectinload(Order.history))
    )
    return schedule(orders, now, day_ops_lookup(db, config), config.work_rates, load_item_work(db))


def active_orders(db: Session, now: datetime | None = None) -> list[Order]:
    return [s.order for s in active_schedule(db, now)]
