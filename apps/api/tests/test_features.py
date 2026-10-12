from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from gedklin_ml.features import (
    DEFAULT_DAY_OPS,
    FEATURE_ORDER,
    DayOps,
    Promise,
    QueueRecord,
    QueueStats,
    build_features,
    content_from_form,
    content_from_items,
    count_loads,
    promised_hours,
    queue_stats,
    shift_into_open_hours,
    to_vector,
    work_hours_between,
)

T0 = datetime(2026, 10, 20, 3, 0, tzinfo=UTC)  # 10:00 WIB, Selasa
PROMISES = {
    "CKL": Promise(regular_hours=48, express_hours=24),
    "CKS": Promise(regular_hours=96, express_hours=24),
    "CK": Promise(regular_hours=None, express_hours=24),
}


@dataclass
class Item:
    group: str
    process: str
    weight_kg: float | None = None
    qty_pcs: int | None = None
    loads: int | None = None


def utc(day: int, hour: int, minute: int = 0) -> datetime:
    """Jam WIB pada Oktober 2026 -> UTC."""
    return datetime(2026, 10, day, hour, minute, tzinfo=UTC) - timedelta(hours=7)


def always(ops: DayOps = DEFAULT_DAY_OPS):  # noqa: ANN201
    return lambda d: ops


def test_count_loads_rule() -> None:
    loads = [count_loads(kg, 7, 1) for kg in (1, 5, 7, 8, 8.5, 9, 15, 16)]
    assert loads == [1, 1, 1, 1, 2, 2, 2, 3]


def test_items_and_form_give_same_content() -> None:
    items = [
        Item("KILOAN", "CKS", weight_kg=6, loads=1),
        Item("KHUSUS", "CKL", qty_pcs=1),
        Item("SATUAN", "SATUAN", qty_pcs=2),
    ]
    from_items = content_from_items(items, is_express=False)
    from_form = content_from_form(
        layanan_utama="cks",
        express=False,
        berat_kg=6,
        pcs_khusus=1,
        pcs_satuan=2,
        ada_setrika=True,
    )
    assert from_items.processes == ("CKS", "CKL", "SATUAN")
    for field in (
        "total_loads",
        "total_weight_kg",
        "max_process_level",
        "has_ironing",
        "ironing_kg",
        "n_special_items",
        "n_satuan_items",
        "dry_loads",
    ):
        assert getattr(from_items, field) == getattr(from_form, field), field


def test_setrika_only_has_ironing_but_no_machine_loads() -> None:
    content = content_from_items([Item("SETRIKA", "S", weight_kg=5)], is_express=False)
    assert content.has_ironing and content.ironing_kg == 5
    assert content.total_loads == 0 and content.max_process_level == 0


def test_queue_stats_only_counts_orders_active_at_time() -> None:
    def rec(received: datetime, ready: datetime | None, express: bool = False) -> QueueRecord:
        return QueueRecord(received, ready, express, loads=2, dry_loads=1, ironing_kg=3.0)

    records = [
        rec(datetime(2026, 10, 20, 1, 0, tzinfo=UTC), None, express=True),
        rec(datetime(2026, 10, 20, 1, 0, tzinfo=UTC), datetime(2026, 10, 20, 4, 0, tzinfo=UTC)),
        # Sudah READY sebelum T0: tidak dihitung.
        rec(datetime(2026, 10, 19, 1, 0, tzinfo=UTC), datetime(2026, 10, 20, 2, 0, tzinfo=UTC)),
        # Masuk setelah T0 (informasi masa depan): tidak dihitung.
        rec(datetime(2026, 10, 20, 5, 0, tzinfo=UTC), None),
    ]
    assert queue_stats(T0, records) == QueueStats(
        count=2, express_count=1, loads=4, dry_loads=2, ironing_kg=6.0
    )


def test_build_features_uses_local_time_and_capacity() -> None:
    content = content_from_form(
        layanan_utama="CKS",
        express=True,
        berat_kg=8,
        pcs_khusus=0,
        pcs_satuan=0,
        ada_setrika=True,
    )
    day = DayOps(washers_available=2, dryers_available=3)
    feats = build_features(
        received_at=T0,
        content=content,
        queue=QueueStats(count=5, express_count=1, loads=8, dry_loads=6, ironing_kg=12),
        day=day,
        promised_hours=24,
    )
    assert feats["hour_of_day"] == 10
    assert feats["day_of_week"] == 1
    assert feats["minutes_to_close"] == 7 * 60  # tutup 17.00
    assert feats["max_process_level"] == 4 and feats["has_ironing"] == 1.0
    assert feats["loads_per_washer"] == 4.0
    assert feats["dry_loads_per_dryer"] == 2.0
    assert len(to_vector(feats)) == len(FEATURE_ORDER)


def test_minutes_to_close_zero_on_closed_day() -> None:
    content = content_from_form(
        layanan_utama="CK", express=False, berat_kg=3, pcs_khusus=0, pcs_satuan=0, ada_setrika=False
    )
    feats = build_features(
        received_at=T0,
        content=content,
        queue=QueueStats(),
        day=DayOps(is_open=False),
        promised_hours=48,
    )
    assert feats["minutes_to_close"] == 0


def test_promised_hours_takes_longest_known_promise() -> None:
    assert promised_hours(["CKL", "CKS"], False, PROMISES, 48) == 96
    assert promised_hours(["CKL", "CKS"], True, PROMISES, 48) == 24
    # Janji CK Reguler belum diketahui -> default.
    assert promised_hours(["CK"], False, PROMISES, 48) == 48
    assert promised_hours(["SATUAN"], False, PROMISES, 36) == 36


def test_shift_into_open_hours() -> None:
    # Dalam jam buka: tetap.
    assert shift_into_open_hours(utc(20, 10), always()) == utc(20, 10)
    # Lewat jam tutup: geser ke jam buka besok.
    assert shift_into_open_hours(utc(20, 18, 30), always()) == utc(21, 8)
    # Sebelum jam buka: geser ke jam buka hari itu.
    assert shift_into_open_hours(utc(20, 6), always()) == utc(20, 8)

    def closed_21(d: date) -> DayOps:
        return DayOps(is_open=False) if d == date(2026, 10, 21) else DEFAULT_DAY_OPS

    assert shift_into_open_hours(utc(20, 18), closed_21) == utc(22, 8)


def test_work_hours_between_counts_only_open_hours() -> None:
    # Selasa 15.00 -> Rabu 10.00: 2 jam + 2 jam.
    assert work_hours_between(utc(20, 15), utc(21, 10), always()) == 4
    short = DayOps(close_time=time(12, 0))
    assert work_hours_between(utc(20, 8), utc(20, 17), always(short)) == 4
