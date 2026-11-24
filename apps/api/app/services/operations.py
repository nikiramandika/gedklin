"""Aturan operasional outlet: jam buka, janji layanan, dan hitungan load mesin."""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Asia/Jakarta")

DRYER_PROCESSES = frozenset({"CK", "CKL", "CKS"})
# Dikerjakan manual oleh petugas tanpa mesin.
IRONING_PROCESSES = frozenset({"CKS", "S", "SATUAN"})

MACHINE_CAPACITY_KG = 8.0
DEFAULT_PROMISE_HOURS = 48.0


def count_loads(qty: float, per_load: float, max_extra: float = 0.0) -> int:
    # Dibulatkan dulu supaya galat float (mis. 14.000000001) tidak menambah load.
    return max(1, math.ceil(round((qty - max_extra) / per_load, 9)))


def machine_loads(weight_kg: float, capacity_kg: float = MACHINE_CAPACITY_KG) -> int:
    if weight_kg <= 0:
        return 0
    return max(1, math.ceil(round(weight_kg / capacity_kg, 9)))


@dataclass(frozen=True)
class DayOps:
    is_open: bool = True
    staff_on_duty: int = 2
    washers_available: int = 4
    dryers_available: int = 3
    open_time: time = time(8, 0)
    close_time: time = time(17, 0)


DEFAULT_DAY_OPS = DayOps()
DayOpsLookup = Callable[[date], DayOps]


@dataclass(frozen=True)
class WorkRates:
    """Lama kerja untuk menaksir waktu proses di penjadwalan antrean."""

    wash_minutes_per_load: float = 60
    dry_minutes_per_load: float = 60
    iron_minutes_per_kg: float = 10
    iron_minutes_per_pcs: float = 5


DEFAULT_WORK_RATES = WorkRates()


@dataclass(frozen=True)
class OutletProfile:
    name: str = "Gedklin Laundry"
    address: str = ""
    phone: str = ""


DEFAULT_OUTLET = OutletProfile()


class ItemLike(Protocol):
    process: str
    is_express: bool


def item_processes(items: Iterable[ItemLike]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Proses Reguler dan proses Express dipisah karena janjinya berbeda."""
    regular: list[str] = []
    express: list[str] = []
    for item in items:
        (express if item.is_express else regular).append(str(item.process))
    return tuple(dict.fromkeys(regular)), tuple(dict.fromkeys(express))


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_local(dt: datetime) -> datetime:
    return _as_utc(dt).astimezone(LOCAL_TZ)


def local_date(dt: datetime) -> date:
    return to_local(dt).date()


def _open_window(day: date, ops: DayOps) -> tuple[datetime, datetime]:
    return (
        datetime.combine(day, ops.open_time, tzinfo=LOCAL_TZ),
        datetime.combine(day, ops.close_time, tzinfo=LOCAL_TZ),
    )


def shift_into_open_hours(dt: datetime, day_ops: DayOpsLookup, max_days: int = 14) -> datetime:
    local = to_local(dt)
    for _ in range(max_days):
        ops = day_ops(local.date())
        if ops.is_open:
            open_dt, close_dt = _open_window(local.date(), ops)
            if local < open_dt:
                return open_dt.astimezone(UTC)
            if local <= close_dt:
                return local.astimezone(UTC)
        local = datetime.combine(local.date() + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
    return _as_utc(dt)


def promise_deadline(
    start: datetime, hours: float, day_ops: DayOpsLookup, max_days: int = 60
) -> datetime:
    """Batas janji: jam kalender dari start, tetapi hari tutup tidak dihitung.

    Kebijakan mitra: pesanan Sabtu dengan janji 2 hari siap Selasa, bukan Senin.
    """
    local = to_local(start)
    end = local + timedelta(hours=max(float(hours), 0.0))
    day = local.date() + timedelta(days=1)
    for _ in range(max_days):
        if day > end.date():
            break
        if not day_ops(day).is_open:
            end += timedelta(days=1)
        day += timedelta(days=1)
    return shift_into_open_hours(end, day_ops)


def work_hours_between(start: datetime, end: datetime, day_ops: DayOpsLookup) -> float:
    start_l, end_l = to_local(start), to_local(end)
    if end_l <= start_l:
        return 0.0
    total = timedelta()
    day = start_l.date()
    while day <= end_l.date():
        ops = day_ops(day)
        if ops.is_open:
            open_dt, close_dt = _open_window(day, ops)
            lo, hi = max(open_dt, start_l), min(close_dt, end_l)
            if hi > lo:
                total += hi - lo
        day += timedelta(days=1)
    return total / timedelta(hours=1)


def add_work_hours(
    start: datetime, hours: float, day_ops: DayOpsLookup, max_days: int = 60
) -> datetime:
    """Maju sejumlah jam kerja dari start; jam tutup dan hari libur dilewati."""
    start_l = to_local(start)
    left = timedelta(hours=max(float(hours), 0.0))
    day = start_l.date()
    for _ in range(max_days):
        ops = day_ops(day)
        if ops.is_open:
            open_dt, close_dt = _open_window(day, ops)
            lo = max(open_dt, start_l)
            if close_dt > lo:
                if close_dt - lo >= left:
                    return (lo + left).astimezone(UTC)
                left -= close_dt - lo
        day += timedelta(days=1)
    return (start_l + left).astimezone(UTC)


def subtract_work_hours(
    end: datetime, hours: float, day_ops: DayOpsLookup, max_days: int = 60
) -> datetime:
    """Mundur sejumlah jam kerja dari end; jam tutup dan hari libur dilewati."""
    end_l = to_local(end)
    left = timedelta(hours=max(float(hours), 0.0))
    day = end_l.date()
    for _ in range(max_days):
        ops = day_ops(day)
        if ops.is_open:
            open_dt, close_dt = _open_window(day, ops)
            hi = min(close_dt, end_l)
            if hi > open_dt:
                if hi - open_dt >= left:
                    return (hi - left).astimezone(UTC)
                left -= hi - open_dt
        day -= timedelta(days=1)
    return (end_l - left).astimezone(UTC)


@dataclass(frozen=True)
class Promise:
    regular_hours: float | None
    express_hours: float | None


def promised_hours(
    items: Iterable[ItemLike],
    promises: Mapping[str, Promise],
    default_hours: float,
) -> float:
    regular, express = item_processes(items)
    known = []
    for processes, is_express in ((regular, False), (express, True)):
        for process in processes:
            promise = promises.get(process)
            if promise is None:
                continue
            hours = promise.express_hours if is_express else promise.regular_hours
            if hours is not None:
                known.append(float(hours))
    return max(known) if known else float(default_hours)
