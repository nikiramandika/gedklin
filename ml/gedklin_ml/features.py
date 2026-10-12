"""Feature builder bersama untuk training (ml/scripts) dan inferensi (apps/api).

Semua fitur dihitung pada saat pesanan masuk (`received_at`) dan tidak boleh
memakai informasi masa depan. Jangan duplikasi logika ini di tempat lain.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    import pandas as pd

LOCAL_TZ = ZoneInfo("Asia/Jakarta")

FEATURE_ORDER: list[str] = [
    "weight_kg",
    "is_cks",
    "is_express",
    "hour_of_day",
    "day_of_week",
    "active_orders_count",
    "active_kg_total",
    "staff_on_duty",
    "minutes_to_close",
]
TARGET = "duration_minutes"

# Nilai cadangan bila tabel harian tidak punya baris untuk tanggal tersebut.
# TODO: sesuaikan dengan hasil wawancara mitra.
DEFAULT_STAFF_ON_DUTY = 2
DEFAULT_OPEN_TIME = time(8, 0)
DEFAULT_CLOSE_TIME = time(21, 0)

SERVICE_TYPES = ("CK", "CKS")


@dataclass(frozen=True)
class QueueRecord:
    """Satu pesanan lain, cukup untuk menghitung kondisi antrean."""

    received_at: datetime
    ready_at: datetime | None
    weight_kg: float


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_local(dt: datetime) -> datetime:
    return _as_utc(dt).astimezone(LOCAL_TZ)


def local_date(dt: datetime) -> date:
    return to_local(dt).date()


def queue_stats(at: datetime, records: Iterable[QueueRecord]) -> tuple[int, float]:
    """Pesanan aktif pada waktu `at`: sudah masuk sebelum `at` dan belum READY."""
    at = _as_utc(at)
    count = 0
    kg = 0.0
    for r in records:
        received = _as_utc(r.received_at)
        ready = _as_utc(r.ready_at) if r.ready_at is not None else None
        if received < at and (ready is None or ready > at):
            count += 1
            kg += float(r.weight_kg)
    return count, round(kg, 2)


def minutes_to_close(received_at: datetime, close_time: time) -> float:
    local = to_local(received_at)
    close_dt = datetime.combine(local.date(), close_time, tzinfo=LOCAL_TZ)
    return max(0.0, (close_dt - local) / timedelta(minutes=1))


def build_features(
    *,
    received_at: datetime,
    weight_kg: float,
    service_type: str,
    is_express: bool,
    active_orders_count: int,
    active_kg_total: float,
    staff_on_duty: int | None,
    close_time: time | None,
) -> dict[str, float]:
    if service_type not in SERVICE_TYPES:
        raise ValueError(f"service_type tidak dikenal: {service_type}")
    local = to_local(received_at)
    return {
        "weight_kg": float(weight_kg),
        "is_cks": 1.0 if service_type == "CKS" else 0.0,
        "is_express": 1.0 if is_express else 0.0,
        "hour_of_day": float(local.hour),
        "day_of_week": float(local.weekday()),
        "active_orders_count": float(active_orders_count),
        "active_kg_total": float(active_kg_total),
        "staff_on_duty": float(
            staff_on_duty if staff_on_duty is not None else DEFAULT_STAFF_ON_DUTY
        ),
        "minutes_to_close": minutes_to_close(received_at, close_time or DEFAULT_CLOSE_TIME),
    }


def to_vector(features: dict[str, float]) -> list[float]:
    return [features[name] for name in FEATURE_ORDER]


def build_feature_frame(orders: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    """Bangun tabel fitur + target dari data mentah.

    `orders` kolom: order_id, received_at (UTC tz-aware), weight_kg, service_type,
    is_express, ready_at (UTC tz-aware). `daily` kolom: date, staff_on_duty,
    open_time, close_time (time lokal).
    """
    import pandas as pd

    daily_map = {
        row.date: (int(row.staff_on_duty), row.close_time) for row in daily.itertuples(index=False)
    }
    records = [
        QueueRecord(r.received_at.to_pydatetime(), r.ready_at.to_pydatetime(), r.weight_kg)
        for r in orders.itertuples(index=False)
    ]

    rows: list[dict[str, object]] = []
    for r in orders.itertuples(index=False):
        received = r.received_at.to_pydatetime()
        staff, close = daily_map.get(local_date(received), (None, None))
        count, kg = queue_stats(received, records)
        feats = build_features(
            received_at=received,
            weight_kg=r.weight_kg,
            service_type=r.service_type,
            is_express=bool(r.is_express),
            active_orders_count=count,
            active_kg_total=kg,
            staff_on_duty=staff,
            close_time=close,
        )
        duration = (r.ready_at - r.received_at) / pd.Timedelta(minutes=1)
        rows.append(
            {
                "order_id": r.order_id,
                "received_at": r.received_at,
                "service_type": r.service_type,
                **feats,
                TARGET: float(duration),
            }
        )
    return pd.DataFrame(rows)
