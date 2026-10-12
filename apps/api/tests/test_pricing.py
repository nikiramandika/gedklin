import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ServiceCatalog
from app.seed import load_catalog_file
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
    expected = {e["code"] for section in ("kiloan", "khusus", "satuan") for e in data[section]}
    assert set(db.scalars(select(ServiceCatalog.code))) == expected


@pytest.mark.parametrize(
    ("kg", "loads", "extra_kg", "subtotal"),
    [
        (5, 1, 0, 45_000),
        (7, 1, 0, 45_000),
        (7.2, 1, 1, 55_000),  # tambahan dibulatkan ke atas per kg
        (8, 1, 1, 55_000),
        (9, 2, 0, 90_000),
        (15, 2, 1, 100_000),
        (16, 3, 0, 135_000),
    ],
)
def test_kiloan_load_rule(db: Session, kg: float, loads: int, extra_kg: int, subtotal: int) -> None:
    priced = price_regular(item(db, "CKS"), weight_kg=kg)
    assert (priced.loads, priced.extra_kg, priced.subtotal) == (loads, extra_kg, subtotal)


def test_express_doubles_base_and_extra(db: Session) -> None:
    # Contoh di Gedklin.md: CKS 8 kg Reguler 55.000, Express 110.000.
    priced = price_item(item(db, "CKS"), 8, None, is_express=True, express_multiplier=2)
    assert priced.subtotal == 110_000
    assert apply_express(25_000, 1.5) == 37_500


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
    assert (priced.loads, priced.extra_pcs, priced.subtotal) == (loads, extra_pcs, subtotal)


def test_sprei_kecil_max_5_kg_per_load_with_extra_pcs(db: Session) -> None:
    sprei = item(db, "SPREI_K")
    assert price_regular(sprei, weight_kg=4).subtotal == 25_000
    assert price_regular(sprei, weight_kg=4, qty_pcs=2).subtotal == 35_000
    two_loads = price_regular(sprei, weight_kg=6, qty_pcs=4)
    assert (two_loads.loads, two_loads.subtotal) == (2, 70_000)
    with pytest.raises(PricingError, match="maksimal 2"):
        price_regular(sprei, weight_kg=4, qty_pcs=3)


def test_missing_quantity_is_rejected(db: Session) -> None:
    with pytest.raises(PricingError, match="berat"):
        price_regular(item(db, "CKL"))
    with pytest.raises(PricingError, match="jumlah"):
        price_regular(item(db, "KEMEJA_PENDEK"), weight_kg=1)


def test_quote_applies_express_to_every_item_and_rejects_inactive(db: Session) -> None:
    requests = [
        ItemRequest("CKS", weight_kg=6),
        ItemRequest("BEDCOVER_B", qty_pcs=1),
        ItemRequest("KEMEJA_PENDEK", qty_pcs=2),
    ]
    regular = quote(db, requests, is_express=False, express_multiplier=2)
    assert regular.total == 45_000 + 35_000 + 30_000
    express = quote(db, requests, is_express=True, express_multiplier=2)
    assert express.total == 2 * regular.total

    item(db, "BEDCOVER_B").is_active = False
    db.flush()
    with pytest.raises(PricingError, match="tidak tersedia"):
        quote(db, requests, is_express=False, express_multiplier=2)
