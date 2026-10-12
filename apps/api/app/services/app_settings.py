"""Pengaturan yang bisa diubah pemilik, janji waktu, dan kondisi operasional harian."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, DailyOperation, ServicePromise
from gedklin_ml.features import DEFAULT_DAY_OPS, DayOps, DayOpsLookup, Promise

# Nilai bawaan bila kunci belum ada di tabel app_settings. Seed mengisi
# express_multiplier dan default_promise_hours dari price_catalog.json.
DEFAULTS: dict[str, str] = {
    "express_multiplier": "2",
    "default_promise_hours": "48",
    "default_staff_on_duty": str(DEFAULT_DAY_OPS.staff_on_duty),
    "default_washers_available": str(DEFAULT_DAY_OPS.washers_available),
    "default_dryers_available": str(DEFAULT_DAY_OPS.dryers_available),
    "default_open_time": DEFAULT_DAY_OPS.open_time.strftime("%H:%M"),
    "default_close_time": DEFAULT_DAY_OPS.close_time.strftime("%H:%M"),
}


@dataclass(frozen=True)
class AppConfig:
    express_multiplier: float
    # Janji bila semua layanan di pesanan belum punya janji standar.
    default_promise_hours: float
    # Kapasitas normal mitra, dipakai bila daily_operations hari itu belum diisi.
    default_day: DayOps


def _parse_time(value: str) -> time:
    return time.fromisoformat(value)


def load_app_config(db: Session) -> AppConfig:
    stored = {row.key: row.value for row in db.scalars(select(AppSetting))}
    v = {**DEFAULTS, **stored}
    return AppConfig(
        express_multiplier=float(v["express_multiplier"]),
        default_promise_hours=float(v["default_promise_hours"]),
        default_day=DayOps(
            is_open=True,
            staff_on_duty=int(v["default_staff_on_duty"]),
            washers_available=int(v["default_washers_available"]),
            dryers_available=int(v["default_dryers_available"]),
            open_time=_parse_time(v["default_open_time"]),
            close_time=_parse_time(v["default_close_time"]),
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
    """Kondisi operasional per tanggal: data harian jika ada, jika tidak kapasitas normal."""
    cache: dict[date, DayOps] = {}

    def lookup(day: date) -> DayOps:
        if day not in cache:
            row = db.scalar(select(DailyOperation).where(DailyOperation.date == day))
            cache[day] = to_day_ops(row) if row else config.default_day
        return cache[day]

    return lookup
