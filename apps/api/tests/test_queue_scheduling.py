from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta

import pytest

from app.models import OrderStatus
from app.services.operations import DEFAULT_DAY_OPS, DayOps, WorkRates
from app.services.queue import hours_until, processing_hours, schedule

RATES = WorkRates(
    wash_minutes_per_load=60,
    dry_minutes_per_load=60,
    iron_minutes_per_kg=10,
    iron_minutes_per_pcs=5,
)
# Selasa 20/10/2026 09.00 WIB.
NOW = datetime(2026, 10, 20, 2, 0, tzinfo=UTC)


def always(ops: DayOps = DEFAULT_DAY_OPS):  # noqa: ANN201
    return lambda d: ops


@dataclass
class Item:
    process: str
    weight_kg: float | None = None
    qty_pcs: int | None = None
    machine_loads: int | None = None


def kiloan(process: str, kg: float) -> Item:
    return Item(process, weight_kg=kg, machine_loads=max(1, -(-int(kg) // 8)))


_ids = iter(range(1, 1000))


@dataclass
class FakeOrder:
    code: str
    items: list[Item]
    promised_ready_at: datetime | None
    status: OrderStatus = OrderStatus.RECEIVED
    received_at: datetime = NOW - timedelta(hours=1)
    id: int = field(default_factory=lambda: next(_ids))


def codes(orders: list[FakeOrder]) -> list[str]:
    return [s.order.code for s in schedule(orders, NOW, always(), RATES)]


def test_processing_hours_from_weight_loads_and_ironing() -> None:
    # 20 kg CKL = 3 load: muat di 4 mesin cuci & 3 pengering, jadi 1 siklus cuci + 1 kering.
    assert processing_hours([kiloan("CKL", 20)], DEFAULT_DAY_OPS, RATES) == 2
    # 10 kg CKS = 2 load + setrika 10 kg x 10 menit dibagi 2 petugas = 50 menit.
    assert processing_hours([kiloan("CKS", 10)], DEFAULT_DAY_OPS, RATES) == pytest.approx(170 / 60)
    # Cuci saja tanpa pengering; satuan disetrika per pcs.
    assert processing_hours([kiloan("C", 5)], DEFAULT_DAY_OPS, RATES) == 1
    assert processing_hours([Item("SATUAN", qty_pcs=4)], DEFAULT_DAY_OPS, RATES) == pytest.approx(
        10 / 60
    )


def test_fewer_machines_make_heavy_orders_take_longer() -> None:
    one_washer = DayOps(washers_available=1, dryers_available=1)
    assert processing_hours([kiloan("CKL", 20)], one_washer, RATES) == 6


def test_heavy_order_near_promise_goes_before_lighter_order_with_earlier_promise() -> None:
    # Ringan: janji 3 jam lagi, proses 2 jam -> slack 1 jam.
    light = FakeOrder("RINGAN", [kiloan("CKL", 4)], NOW + timedelta(hours=3))
    # Berat: janji 4,5 jam lagi, proses 4 jam (cuci, kering, setrika 24 kg) -> slack 0,5 jam.
    heavy = FakeOrder("BERAT", [kiloan("CKS", 24)], NOW + timedelta(hours=4.5))
    entries = schedule([light, heavy], NOW, always(), RATES)
    assert [e.order.code for e in entries] == ["BERAT", "RINGAN"]
    assert [e.slack_hours for e in entries] == [0.5, 1.0]
    assert [e.processing_hours for e in entries] == [4.0, 2.0]


def test_express_needs_no_special_lane_because_its_promise_is_shorter() -> None:
    regular = FakeOrder("REG", [kiloan("CKL", 5)], NOW + timedelta(hours=47))
    express = FakeOrder("EXP", [kiloan("CKL", 5)], NOW + timedelta(hours=23))
    assert codes([regular, express]) == ["EXP", "REG"]


def test_regular_close_to_promise_goes_before_new_express() -> None:
    regular = FakeOrder("REGMEPET", [kiloan("CKL", 5)], NOW + timedelta(hours=3))
    express = FakeOrder("EXPBARU", [kiloan("CKL", 5)], NOW + timedelta(hours=24))
    assert codes([express, regular]) == ["REGMEPET", "EXPBARU"]


def test_processing_order_is_not_overtaken() -> None:
    started = FakeOrder(
        "PROSES", [kiloan("CKL", 5)], NOW + timedelta(hours=40), status=OrderStatus.PROCESSING
    )
    urgent = FakeOrder("MENDESAK", [kiloan("CKL", 5)], NOW + timedelta(hours=1))
    assert codes([urgent, started]) == ["PROSES", "MENDESAK"]


def test_overdue_orders_have_negative_slack_and_most_late_first() -> None:
    late = FakeOrder("TELAT2", [kiloan("CKL", 5)], NOW - timedelta(minutes=30))
    later = FakeOrder("TELAT1", [kiloan("CKL", 5)], NOW - timedelta(minutes=10))
    entries = schedule([later, late], NOW, always(), RATES)
    assert [e.order.code for e in entries] == ["TELAT2", "TELAT1"]
    assert entries[0].slack_hours == pytest.approx(-2.5)


def test_orders_without_promise_go_last_and_ties_are_fifo() -> None:
    legacy = FakeOrder("LAMA", [kiloan("CKL", 5)], None, received_at=NOW - timedelta(days=2))
    first = FakeOrder("A", [kiloan("CKL", 5)], NOW + timedelta(hours=10), received_at=NOW)
    second = FakeOrder("B", [kiloan("CKL", 5)], NOW + timedelta(hours=10), received_at=NOW)
    second.received_at = NOW + timedelta(minutes=1)
    assert codes([legacy, second, first]) == ["A", "B", "LAMA"]


def test_slack_counts_only_open_hours() -> None:
    # Selasa 16.00 -> Rabu 09.00: 1 jam (16-17) + 1 jam (08-09).
    tuesday_4pm = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)
    wednesday_9am = datetime(2026, 10, 21, 2, 0, tzinfo=UTC)
    assert hours_until(wednesday_9am, tuesday_4pm, always()) == 2
    assert hours_until(tuesday_4pm, wednesday_9am, always()) == -2
    short = DayOps(close_time=time(12, 0))
    assert hours_until(wednesday_9am, tuesday_4pm, always(short)) == 1
