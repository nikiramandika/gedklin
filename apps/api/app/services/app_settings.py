from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, DailyOperation, ServicePromise
from gedklin_ml.features import (
    DEFAULT_DAY_OPS,
    DEFAULT_PROMISE_HOURS,
    MACHINE_CAPACITY_KG,
    DayOps,
    DayOpsLookup,
    Promise,
)

DEFAULTS: dict[str, str] = {
    "express_multiplier": "2",
    "machine_capacity_kg": f"{MACHINE_CAPACITY_KG:g}",
    "default_promise_hours": f"{DEFAULT_PROMISE_HOURS:g}",
    "default_staff_on_duty": str(DEFAULT_DAY_OPS.staff_on_duty),
    "default_washers_available": str(DEFAULT_DAY_OPS.washers_available),
    "default_dryers_available": str(DEFAULT_DAY_OPS.dryers_available),
    "default_open_time": DEFAULT_DAY_OPS.open_time.strftime("%H:%M"),
    "default_close_time": DEFAULT_DAY_OPS.close_time.strftime("%H:%M"),
    # Hari tutup rutin (0 = Senin ... 6 = Minggu), dipisah koma. Kosong = buka tiap hari.
    "closed_weekdays": "",
}


@dataclass(frozen=True)
class AppConfig:
    express_multiplier: float
    machine_capacity_kg: float
    default_promise_hours: float
    default_day: DayOps
    closed_weekdays: frozenset[int] = frozenset()


def _parse_time(value: str) -> time:
    return time.fromisoformat(value)


def parse_weekdays(value: str) -> frozenset[int]:
    return frozenset(int(v) for v in value.split(",") if v.strip())


def format_weekdays(days: Iterable[int]) -> str:
    return ",".join(str(d) for d in sorted(set(days)))


def load_app_config(db: Session) -> AppConfig:
    stored = {row.key: row.value for row in db.scalars(select(AppSetting))}
    v = {**DEFAULTS, **stored}
    return AppConfig(
        express_multiplier=float(v["express_multiplier"]),
        machine_capacity_kg=float(v["machine_capacity_kg"]),
        default_promise_hours=float(v["default_promise_hours"]),
        default_day=DayOps(
            is_open=True,
            staff_on_duty=int(v["default_staff_on_duty"]),
            washers_available=int(v["default_washers_available"]),
            dryers_available=int(v["default_dryers_available"]),
            open_time=_parse_time(v["default_open_time"]),
            close_time=_parse_time(v["default_close_time"]),
        ),
        closed_weekdays=parse_weekdays(v["closed_weekdays"]),
    )


def save_app_settings(db: Session, values: dict[str, str]) -> None:
    for key, value in values.items():
        if key not in DEFAULTS:
            raise KeyError(key)
        row = db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value


def load_promises(db: Session) -> dict[str, Promise]:
    return {
        row.process.value: Promise(regular_hours=row.regular_hours, express_hours=row.express_hours)
        for row in db.scalars(select(ServicePromise))
    }


def to_day_ops(row: DailyOperation) -> DayOps:
    return DayOps(
        is_open=row.is_open,
        staff_on_duty=row.staff_on_duty,
        washers_available=row.washers_available,
        dryers_available=row.dryers_available,
        open_time=row.open_time,
        close_time=row.close_time,
    )


def day_ops_lookup(db: Session, config: AppConfig) -> DayOpsLookup:
    cache: dict[date, DayOps] = {}

    def lookup(day: date) -> DayOps:
        if day not in cache:
            row = db.scalar(select(DailyOperation).where(DailyOperation.date == day))
            if row is not None:
                # Data harian menang: hari tutup rutin tetap bisa dibuka per tanggal.
                cache[day] = to_day_ops(row)
            elif day.weekday() in config.closed_weekdays:
                cache[day] = replace(config.default_day, is_open=False)
            else:
                cache[day] = config.default_day
        return cache[day]

    return lookup
