import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ServiceCatalog
from app.seed import SECTIONS, load_catalog_file
from app.services.pricing import (
    ItemRequest,
    PricingError,
    apply_express,
    price_item,
    price_regular,
    quote,
)


def item(db: Session, code: str) -> ServiceCatalog:
    entry = db.scalar(select(ServiceCatalog).where(ServiceCatalog.code == code))
    assert entry is not None
    return entry


def test_whole_price_list_is_seeded(db: Session) -> None:
    data = load_catalog_file()
    expected = {e["code"] for section in SECTIONS for e in data[section]}
    assert set(db.scalars(select(ServiceCatalog.code))) == expected


@pytest.mark.parametrize(
    ("kg", "extra_kg", "subtotal", "machine_loads"),
    [
        (5, 0, 45_000, 1),
        (7, 0, 45_000, 1),
        (7.2, 1, 55_000, 1),  # tambahan dibulatkan ke atas per kg (asumsi)
        (8, 1, 55_000, 1),
        (9, 2, 65_000, 2),  # di atas 8 kg tidak dihitung load kedua untuk harga
        (12, 5, 95_000, 2),  # contoh di Gedklin.md
        (16, 9, 135_000, 2),
        (16.5, 10, 145_000, 3),
    ],
)
def test_kiloan_price_per_kg_and_machine_loads(
    db: Session, kg: float, extra_kg: int, subtotal: int, machine_loads: int
) -> None:
    priced = price_regular(item(db, "CKS"), weight_kg=kg)
    assert (priced.extra_kg, priced.subtotal, priced.machine_loads) == (
        extra_kg,
        subtotal,
        machine_loads,
    )


@pytest.mark.parametrize(("code", "extra"), [("C", 3_000), ("CK", 5_000), ("CKL", 7_000)])
def test_kiloan_extra_price_per_service(db: Session, code: str, extra: int) -> None:
    entry = item(db, code)
    assert price_regular(entry, weight_kg=10).subtotal == entry.price + 3 * extra


def test_express_doubles_base_and_extra(db: Session) -> None:
    # Contoh di Gedklin.md: CKS 8 kg Reguler 55.000, Express 110.000.
    priced = price_item(item(db, "CKS"), 8, None, is_express=True, express_multiplier=2)
    assert priced.subtotal == 110_000 and priced.is_express
    assert apply_express(25_000, 1.5) == 37_500


def test_express_only_for_ckl_and_cks(db: Session) -> None:
    eligible = {c.code for c in db.scalars(select(ServiceCatalog)) if c.express_eligible}
    assert eligible == {"CKL", "CKS"}
    for code, kwargs in (("CK", {"weight_kg": 5}), ("BEDCOVER_K", {"qty_pcs": 1})):
        regular = price_regular(item(db, code), **kwargs)
        express = price_item(
            item(db, code),
            kwargs.get("weight_kg"),
            kwargs.get("qty_pcs"),
            is_express=True,
            express_multiplier=2,
        )
        assert express.subtotal == regular.subtotal and not express.is_express


@pytest.mark.parametrize(("kg", "subtotal"), [(3, 25_000), (5, 25_000), (6.5, 32_500)])
def test_setrika_minimum_5_kg(db: Session, kg: float, subtotal: int) -> None:
    assert price_regular(item(db, "SETRIKA"), weight_kg=kg).subtotal == subtotal


def test_gordyn_per_kg_minimum_5_kg(db: Session) -> None:
    assert price_regular(item(db, "GORDYN"), weight_kg=2).subtotal == 50_000
    assert price_regular(item(db, "GORDYN"), weight_kg=7).subtotal == 70_000


def test_per_pcs_items(db: Session) -> None:
    assert price_regular(item(db, "BEDCOVER_K"), qty_pcs=2).subtotal == 60_000
    assert price_regular(item(db, "JAKET"), qty_pcs=1).subtotal == 25_000
    assert price_regular(item(db, "KEMEJA_PANJANG"), qty_pcs=2).subtotal == 34_000


@pytest.mark.parametrize(
    ("code", "pcs", "loads", "extra_pcs", "subtotal"),
    [
        # Selimut kecil: 3 pcs/load, tambahan 5.000/pcs maks 2.
        ("SELIMUT_K", 1, 1, 0, 25_000),
        ("SELIMUT_K", 5, 1, 2, 35_000),
        ("SELIMUT_K", 6, 2, 0, 50_000),
        # Selimut besar: maks 2 pcs/load, tambahan 10.000/pcs maks 1.
        ("SELIMUT_B", 2, 1, 0, 25_000),
        ("SELIMUT_B", 3, 1, 1, 35_000),
        ("SELIMUT_B", 4, 2, 0, 50_000),
        # Sprei besar rimple: maks 2 pcs/load, tambahan 10.000/pcs maks 1.
        ("SPREI_B_RIMPLE", 3, 1, 1, 35_000),
        # Sprei besar non rimple: maks 4 pcs/load, tambahan 7.000/pcs maks 1.
        ("SPREI_B_NONRIMPLE", 5, 1, 1, 32_000),
        ("SPREI_B_NONRIMPLE", 6, 2, 0, 50_000),
    ],
)
def test_special_items_per_load_by_pcs(
    db: Session, code: str, pcs: int, loads: int, extra_pcs: int, subtotal: int
) -> None:
    priced = price_regular(item(db, code), qty_pcs=pcs)
    assert (priced.machine_loads, priced.extra_pcs, priced.subtotal) == (loads, extra_pcs, subtotal)


def test_sprei_kecil_max_5_kg_per_load_with_extra_pcs(db: Session) -> None:
    sprei = item(db, "SPREI_K")
    assert price_regular(sprei, weight_kg=4).subtotal == 25_000
    assert price_regular(sprei, weight_kg=4, qty_pcs=2).subtotal == 35_000
    two_loads = price_regular(sprei, weight_kg=6, qty_pcs=4)
    assert (two_loads.machine_loads, two_loads.subtotal) == (2, 70_000)
    with pytest.raises(PricingError, match="maksimal 2"):
        price_regular(sprei, weight_kg=4, qty_pcs=3)


def test_missing_quantity_is_rejected(db: Session) -> None:
    with pytest.raises(PricingError, match="berat"):
        price_regular(item(db, "CKL"))
    with pytest.raises(PricingError, match="jumlah"):
        price_regular(item(db, "KEMEJA_PENDEK"), weight_kg=1)


def test_quote_express_only_doubles_eligible_items_and_rejects_inactive(db: Session) -> None:
    requests = [
        ItemRequest("CKS", weight_kg=6),
        ItemRequest("BEDCOVER_B", qty_pcs=1),
        ItemRequest("KEMEJA_PENDEK", qty_pcs=2),
    ]
    regular = quote(db, requests, is_express=False, express_multiplier=2)
    assert regular.total == 45_000 + 35_000 + 30_000
    express = quote(db, requests, is_express=True, express_multiplier=2)
    assert express.total == 2 * 45_000 + 35_000 + 30_000
    assert [i.is_express for i in express.items] == [True, False, False]

    item(db, "BEDCOVER_B").is_active = False
    db.flush()
    with pytest.raises(PricingError, match="tidak tersedia"):
        quote(db, requests, is_express=False, express_multiplier=2)


def test_express_rejected_without_ckl_or_cks(db: Session) -> None:
    requests = [ItemRequest("CK", weight_kg=5), ItemRequest("BEDCOVER_K", qty_pcs=1)]
    with pytest.raises(PricingError, match="Express hanya"):
        quote(db, requests, is_express=True, express_multiplier=2)


def test_dry_clean_without_price_is_inactive_and_not_priced(db: Session) -> None:
    songket = item(db, "DC_SONGKET")
    assert songket.price is None and not songket.is_active
    with pytest.raises(PricingError, match="harga belum"):
        price_regular(songket, qty_pcs=1)
    songket.price = 50_000
    assert price_regular(songket, qty_pcs=2).subtotal == 100_000
