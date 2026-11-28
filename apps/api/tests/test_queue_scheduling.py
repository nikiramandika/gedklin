from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, time, timedelta

import pytest

from app.models import CatalogUnit, OrderStatus
from app.services.operations import DEFAULT_DAY_OPS, DayOps, WorkRates
from app.services.queue import ItemWork, hours_until, processing_hours, schedule

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
    catalog_code: str = ""


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
    history: list[object] = field(default_factory=list)


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


def test_latest_start_steps_back_over_closed_hours() -> None:
    # Janji Rabu 09.00, lama kerja 2 jam (CKL 5 kg): mundur ke 08.00, lalu ke Selasa 16.00.
    wednesday_9am = datetime(2026, 10, 21, 2, 0, tzinfo=UTC)
    order = FakeOrder("BESOK", [kiloan("CKL", 5)], wednesday_9am)
    (entry,) = schedule([order], NOW, always(), RATES)
    assert entry.latest_start_at == datetime(2026, 10, 20, 9, 0, tzinfo=UTC)
    # Slack = jarak jam kerja dari sekarang sampai batas mulai itu.
    assert entry.slack_hours == hours_until(entry.latest_start_at, NOW, always()) == 7


def test_catalog_work_minutes_are_used_as_is() -> None:
    work = {
        "BEDCOVER": ItemWork(CatalogUnit.PCS, 150),
        "GORDYN": ItemWork(CatalogUnit.KG, 20),
        "SPREI": ItemWork(CatalogUnit.LOAD, 90),
        "BONEKA": ItemWork(CatalogUnit.PCS, 60),
    }
    bedcover = Item("CKL", qty_pcs=2, catalog_code="BEDCOVER")
    gordyn = Item("CKL", weight_kg=6, catalog_code="GORDYN")
    sprei = Item("CKL", weight_kg=10, machine_loads=2, catalog_code="SPREI")
    boneka = Item("SATUAN", qty_pcs=1, catalog_code="BONEKA")
    # Dulu bed cover dan gordyn terhitung 0 jam karena tidak menghasilkan load mesin.
    assert processing_hours([bedcover], DEFAULT_DAY_OPS, RATES) == 0
    # Lama kerja katalog x jumlah, tidak dibagi ke petugas.
    assert processing_hours([bedcover], DEFAULT_DAY_OPS, RATES, work) == 5
    assert processing_hours([gordyn], DEFAULT_DAY_OPS, RATES, work) == 2
    assert processing_hours([sprei], DEFAULT_DAY_OPS, RATES, work) == 3
    assert processing_hours([boneka], DEFAULT_DAY_OPS, RATES, work) == 1
    assert processing_hours([boneka], DayOps(staff_on_duty=4), RATES, work) == 1
    # Item kiloan tanpa lama kerja sendiri tetap dihitung dari mesin, lalu dijumlah.
    mixed = [boneka, kiloan("CKL", 5)]
    assert processing_hours(mixed, DEFAULT_DAY_OPS, RATES, work) == 3


def test_kiloan_counts_machine_rounds_and_per_order_is_fixed() -> None:
    work = {
        "CKL": ItemWork(CatalogUnit.KILOAN_7KG, 180),
        "GORDYN": ItemWork(CatalogUnit.KG, 1080, per_order=True),
    }

    def ckl(kg: float) -> Item:
        return Item("CKL", weight_kg=kg, machine_loads=max(1, -(-int(kg) // 8)), catalog_code="CKL")

    # 4 mesin: sampai 4 load selesai dalam 1 putaran (3 jam), 5 load butuh 2 putaran.
    assert processing_hours([ckl(4)], DEFAULT_DAY_OPS, RATES, work) == 3
    assert processing_hours([ckl(24)], DEFAULT_DAY_OPS, RATES, work) == 3
    assert processing_hours([ckl(40)], DEFAULT_DAY_OPS, RATES, work) == 6
    # Mesin tinggal 2: 3 load jadi 2 putaran.
    assert processing_hours([ckl(24)], DayOps(washers_available=2), RATES, work) == 6
    # Gordyn 2 hari kerja (18 jam) per pesanan, berapa pun beratnya.
    for kg in (2, 9):
        gordyn = Item("CKL", weight_kg=kg, catalog_code="GORDYN")
        assert processing_hours([gordyn], DEFAULT_DAY_OPS, RATES, work) == 18


# ---------- Simulasi mesin dan petugas paralel ----------

FAR = NOW + timedelta(days=5)


def test_single_order_forecast_matches_processing_time() -> None:
    (entry,) = schedule([FakeOrder("A", [kiloan("CKS", 10)], FAR)], NOW, always(), RATES)
    assert entry.forecast is not None
    assert entry.forecast.start == 0
    assert entry.forecast.ready == pytest.approx(entry.processing_hours, abs=0.01)
    assert entry.forecast.staff == 2


def test_orders_share_machines_and_wait_their_turn() -> None:
    # 5 pesanan 1 load, 4 mesin cuci dan 3 pengering: load ke-5 menunggu mesin cuci, load ke-4
    # dan ke-5 menunggu pengering. Tiap pesanan sendirian butuh 2 jam.
    orders = [FakeOrder(f"P{i}", [kiloan("CKL", 8)], FAR + timedelta(hours=i)) for i in range(5)]
    entries = schedule(orders, NOW, always(), RATES)
    assert [e.processing_hours for e in entries] == [2.0] * 5
    assert [e.forecast.ready for e in entries] == [2, 2, 2, 3, 3]
    assert [e.forecast.start for e in entries] == [0, 0, 0, 0, 1]


def test_staff_work_in_parallel_when_one_is_busy() -> None:
    # Setrika saja 12 kg = 120 menit untuk satu petugas: dua petugas bersama, 1 jam.
    ironing = Item("S", weight_kg=12)
    urgent = FakeOrder("SETRIKA", [ironing], NOW + timedelta(hours=3))
    # CKS: setrika baru bisa mulai setelah cuci-kering 2 jam. Saat itu kedua petugas kosong.
    cks = FakeOrder("CKS", [kiloan("CKS", 6)], FAR)
    entries = schedule([cks, urgent], NOW, always(), RATES)
    by_code = {e.order.code: e.forecast for e in entries}
    assert by_code["SETRIKA"].ready == 1 and by_code["SETRIKA"].staff == 2
    assert by_code["CKS"].start == 0 and by_code["CKS"].ready == 2.5

    # Pesanan setrika kedua menunggu kedua petugas kosong lagi (jam 1).
    staff_busy = [urgent, FakeOrder("S2", [ironing], NOW + timedelta(hours=4))]
    s1, s2 = schedule(staff_busy, NOW, always(), RATES)
    assert (s1.forecast.ready, s2.forecast.start, s2.forecast.ready) == (1, 1, 2)


def test_forecast_flags_late_even_when_slack_looks_fine() -> None:
    # Sendirian tiap pesanan punya slack 1 jam, tapi pesanan kelima harus antre mesin.
    orders = [FakeOrder(f"P{i}", [kiloan("CKL", 8)], NOW + timedelta(hours=3)) for i in range(5)]
    entries = schedule(orders, NOW, always(), RATES)
    assert all(e.slack_hours == 1 for e in entries)
    assert [e.forecast.late_hours for e in entries] == [0, 0, 0, 0, 0]
    tight = [FakeOrder(f"T{i}", [kiloan("CKL", 8)], NOW + timedelta(hours=2)) for i in range(5)]
    late = [e.forecast.late_hours for e in schedule(tight, NOW, always(), RATES)]
    assert late == [0, 0, 0, 1, 1]


@dataclass
class History:
    to_status: OrderStatus
    changed_at: datetime


def test_started_order_counts_time_already_spent() -> None:
    started = FakeOrder(
        "JALAN",
        [kiloan("CKL", 8)],
        FAR,
        status=OrderStatus.PROCESSING,
        history=[History(OrderStatus.PROCESSING, NOW - timedelta(minutes=30))],
    )
    (entry,) = schedule([started], NOW, always(), RATES)
    # Sudah jalan setengah jam dari 2 jam: sisa 1,5 jam.
    assert entry.forecast.start == -0.5
    assert entry.forecast.ready == 1.5
    assert entry.forecast.ready_at == NOW + timedelta(hours=1, minutes=30)
    # Mulai sebelum toko buka (07.30): hanya jam kerja sejak 08.00 yang terhitung.
    early = replace(started, history=[History(OrderStatus.PROCESSING, NOW - timedelta(hours=1.5))])
    (entry,) = schedule([early], NOW, always(), RATES)
    assert entry.forecast.start == -1
