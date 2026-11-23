from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from app.services.operations import (
    DEFAULT_DAY_OPS,
    DayOps,
    Promise,
    count_loads,
    item_processes,
    machine_loads,
    promise_deadline,
    promised_hours,
    shift_into_open_hours,
    work_hours_between,
)

PROMISES = {
    "CKL": Promise(regular_hours=48, express_hours=24),
    "CKS": Promise(regular_hours=96, express_hours=24),
    "CK": Promise(regular_hours=None, express_hours=None),
}


@dataclass
class Item:
    process: str
    is_express: bool = False


def utc(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=UTC) - timedelta(hours=7)


def always(ops: DayOps = DEFAULT_DAY_OPS):  # noqa: ANN201
    return lambda d: ops


def test_count_loads_rule_for_special_items() -> None:
    # Selimut besar: 2 pcs/load + maks 1 pcs tambahan.
    assert [count_loads(pcs, 2, 1) for pcs in (1, 2, 3, 4, 6, 7)] == [1, 1, 1, 2, 3, 3]


def test_machine_loads_8_kg_per_machine() -> None:
    loads = [machine_loads(kg) for kg in (0, 1, 7, 8, 8.5, 12, 16, 16.1)]
    assert loads == [0, 1, 1, 1, 2, 2, 2, 3]
    assert machine_loads(12, capacity_kg=10) == 2


def test_item_processes_split_regular_and_express_without_duplicates() -> None:
    items = [Item("CKS", True), Item("CKL"), Item("CKS", True), Item("SATUAN")]
    assert item_processes(items) == (("CKL", "SATUAN"), ("CKS",))


def test_promised_hours_takes_longest_known_promise() -> None:
    ckl, cks = Item("CKL"), Item("CKS")
    assert promised_hours([ckl, cks], PROMISES, 48) == 96
    express_ckl, express_cks = Item("CKL", is_express=True), Item("CKS", is_express=True)
    assert promised_hours([express_ckl, express_cks], PROMISES, 48) == 24
    # Bedcover tidak bisa Express, jadi janji Reguler CKL (48 jam) yang berlaku.
    assert promised_hours([express_cks, ckl], PROMISES, 48) == 48
    assert promised_hours([Item("CK")], PROMISES, 48) == 48
    assert promised_hours([Item("SATUAN")], PROMISES, 36) == 36


def test_shift_into_open_hours() -> None:
    assert shift_into_open_hours(utc(20, 10), always()) == utc(20, 10)
    assert shift_into_open_hours(utc(20, 18, 30), always()) == utc(21, 8)
    assert shift_into_open_hours(utc(20, 6), always()) == utc(20, 8)

    def closed_21(d: date) -> DayOps:
        return DayOps(is_open=False) if d == date(2026, 10, 21) else DEFAULT_DAY_OPS

    assert shift_into_open_hours(utc(20, 18), closed_21) == utc(22, 8)


def test_promise_deadline_skips_closed_days() -> None:
    def closed_sunday(d: date) -> DayOps:
        return DayOps(is_open=False) if d.weekday() == 6 else DEFAULT_DAY_OPS

    # Selasa + 2 hari tanpa hari tutup: tetap 48 jam kalender.
    assert promise_deadline(utc(20, 10), 48, closed_sunday) == utc(22, 10)
    # Sabtu 24 Okt 10.00 + 2 hari: Minggu tidak dihitung, jadi Selasa, bukan Senin.
    assert promise_deadline(utc(24, 10), 48, closed_sunday) == utc(27, 10)
    # Jumat 23 Okt + 2 hari melewati Minggu: Senin.
    assert promise_deadline(utc(23, 10), 48, closed_sunday) == utc(26, 10)
    # Sabtu sore + 1 hari jatuh di luar jam buka Senin, digeser ke jam buka berikutnya.
    assert promise_deadline(utc(24, 16), 24, closed_sunday) == utc(26, 16)


def test_work_hours_between_counts_only_open_hours() -> None:
    # Selasa 15.00 -> Rabu 10.00: 2 jam + 2 jam.
    assert work_hours_between(utc(20, 15), utc(21, 10), always()) == 4
    short = DayOps(close_time=time(12, 0))
    assert work_hours_between(utc(20, 8), utc(20, 17), always(short)) == 4
