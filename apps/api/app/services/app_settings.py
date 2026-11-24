from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, DailyOperation, ServiceCatalog
from app.services.operations import (
    DEFAULT_DAY_OPS,
    DEFAULT_OUTLET,
    DEFAULT_PROMISE_HOURS,
    DEFAULT_WORK_RATES,
    MACHINE_CAPACITY_KG,
    DayOps,
    DayOpsLookup,
    OutletProfile,
    Promise,
    WorkRates,
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
    # Tampil di nota, WhatsApp, dan halaman lacak.
    "outlet_name": DEFAULT_OUTLET.name,
    "outlet_address": DEFAULT_OUTLET.address,
    "outlet_phone": DEFAULT_OUTLET.phone,
    # Lama kerja untuk penjadwalan antrean LST (menit).
    "wash_minutes_per_load": f"{DEFAULT_WORK_RATES.wash_minutes_per_load:g}",
    "dry_minutes_per_load": f"{DEFAULT_WORK_RATES.dry_minutes_per_load:g}",
    "iron_minutes_per_kg": f"{DEFAULT_WORK_RATES.iron_minutes_per_kg:g}",
    "iron_minutes_per_pcs": f"{DEFAULT_WORK_RATES.iron_minutes_per_pcs:g}",
}


@dataclass(frozen=True)
class AppConfig:
    express_multiplier: float
    machine_capacity_kg: float
    default_promise_hours: float
    default_day: DayOps
    closed_weekdays: frozenset[int] = frozenset()
    outlet: OutletProfile = DEFAULT_OUTLET
    work_rates: WorkRates = DEFAULT_WORK_RATES


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
        outlet=OutletProfile(
            name=v["outlet_name"], address=v["outlet_address"], phone=v["outlet_phone"]
        ),
        work_rates=WorkRates(
            wash_minutes_per_load=float(v["wash_minutes_per_load"]),
            dry_minutes_per_load=float(v["dry_minutes_per_load"]),
            iron_minutes_per_kg=float(v["iron_minutes_per_kg"]),
            iron_minutes_per_pcs=float(v["iron_minutes_per_pcs"]),
        ),
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
    """Janji per item katalog, dikunci dengan kode layanan."""
    rows = db.execute(
        select(
            ServiceCatalog.code, ServiceCatalog.promise_hours, ServiceCatalog.express_promise_hours
        )
    )
    return {
        code: Promise(regular_hours=regular, express_hours=express)
        for code, regular, express in rows
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
