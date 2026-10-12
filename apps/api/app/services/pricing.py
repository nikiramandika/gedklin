"""Satu-satunya tempat logika harga. Harga dibaca dari tabel service_catalog.

Aturan per satuan katalog:
- LOAD_7KG (kiloan): `loads = max(1, ceil((kg - max_extra) / kg_per_load))`,
  `extra_kg = ceil(kg - kg_per_load * loads)` (maks `max_extra` per pesanan item),
  `subtotal = loads * price + extra_kg * extra_price`.
  Contoh 7 kg + maks 1 kg: 5 kg = 1 load, 8 kg = 1 load + 1 kg, 9 kg = 2 load.
- KG: `subtotal = max(kg, min_qty) * price` (mis. setrika minimal 5 kg).
- PCS: `subtotal = qty * price`.
- LOAD (item khusus):
  - kapasitas per pcs (`pcs_per_load`): aturan sama dengan kiloan tetapi dalam pcs,
    tambahan per pcs maks `max_extra`.
  - kapasitas per kg (`kg_per_load`, mis. sprei kecil maks 5 kg/load):
    `loads = ceil(kg / kg_per_load)`, tambahan pcs diisi kasir, maks `max_extra` per load.
Express: `subtotal_express = subtotal_reguler * express_multiplier`, untuk semua item.
Aturan load dan Express untuk item khusus/satuan masih menunggu konfirmasi mitra.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CatalogGroup, CatalogUnit, Process, ServiceCatalog
from gedklin_ml.features import count_loads


class PricingError(ValueError):
    pass


class CatalogLike(Protocol):
    code: str
    name: str
    group: CatalogGroup
    process: Process
    unit: CatalogUnit
    price: int
    extra_price: int | None
    min_qty: float | None
    kg_per_load: float | None
    pcs_per_load: int | None
    max_extra: float | None


@dataclass(frozen=True)
class ItemRequest:
    catalog_code: str
    weight_kg: float | None = None
    qty_pcs: int | None = None


@dataclass(frozen=True)
class PricedItem:
    catalog_code: str
    name: str
    group: CatalogGroup
    process: Process
    weight_kg: float | None
    qty_pcs: int | None
    loads: int | None
    extra_kg: int | None
    extra_pcs: int | None
    subtotal: int


@dataclass(frozen=True)
class Quote:
    items: list[PricedItem]
    total: int
    is_express: bool
    express_multiplier: float


def _ceil(value: float) -> int:
    # Dibulatkan dulu supaya galat float (mis. 1.0000000002) tidak menambah 1.
    return math.ceil(round(value, 6))


def _need_weight(item: CatalogLike, weight_kg: float | None) -> float:
    if weight_kg is None or weight_kg <= 0:
        raise PricingError(f"{item.name}: isi berat (kg)")
    return float(weight_kg)


def _need_pcs(item: CatalogLike, qty_pcs: int | None) -> int:
    if qty_pcs is None or qty_pcs < 1:
        raise PricingError(f"{item.name}: isi jumlah (pcs)")
    return int(qty_pcs)


def price_regular(
    item: CatalogLike, weight_kg: float | None = None, qty_pcs: int | None = None
) -> PricedItem:
    """Harga Reguler satu item sesuai aturan satuan katalog."""
    loads = extra_kg = extra_pcs = None
    weight: float | None = None
    pcs: int | None = None
    extra_price = item.extra_price or 0
    max_extra = item.max_extra or 0

    if item.unit == CatalogUnit.LOAD_7KG:
        weight = _need_weight(item, weight_kg)
        per_load = item.kg_per_load or 7
        loads = count_loads(weight, per_load, max_extra)
        extra_kg = _ceil(max(0.0, weight - per_load * loads))
        subtotal = loads * item.price + extra_kg * extra_price
    elif item.unit == CatalogUnit.KG:
        weight = _need_weight(item, weight_kg)
        subtotal = _ceil(max(weight, item.min_qty or 0) * item.price)
    elif item.unit == CatalogUnit.PCS:
        pcs = _need_pcs(item, qty_pcs)
        subtotal = pcs * item.price
    elif item.kg_per_load:  # LOAD, kapasitas per kg
        weight = _need_weight(item, weight_kg)
        loads = count_loads(weight, item.kg_per_load)
        pcs = int(qty_pcs or 0)
        if pcs < 0 or pcs > max_extra * loads:
            raise PricingError(
                f"{item.name}: tambahan maksimal {max_extra * loads:g} pcs untuk {loads} load"
            )
        extra_pcs = pcs
        subtotal = loads * item.price + extra_pcs * extra_price
    elif item.pcs_per_load:  # LOAD, kapasitas per pcs
        pcs = _need_pcs(item, qty_pcs)
        loads = count_loads(pcs, item.pcs_per_load, max_extra)
        extra_pcs = max(0, pcs - item.pcs_per_load * loads)
        subtotal = loads * item.price + extra_pcs * extra_price
    else:
        raise PricingError(f"{item.name}: aturan load belum diatur di katalog")

    if item.min_qty and item.unit != CatalogUnit.KG:
        qty = weight if weight is not None else pcs
        if qty is not None and qty < item.min_qty:
            raise PricingError(f"{item.name}: minimal {item.min_qty:g}")

    return PricedItem(
        catalog_code=item.code,
        name=item.name,
        group=item.group,
        process=item.process,
        weight_kg=weight,
        qty_pcs=pcs,
        loads=loads,
        extra_kg=extra_kg,
        extra_pcs=extra_pcs,
        subtotal=int(subtotal),
    )


def apply_express(subtotal_regular: int, multiplier: float) -> int:
    value = Decimal(subtotal_regular) * Decimal(str(multiplier))
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def price_item(
    item: CatalogLike,
    weight_kg: float | None,
    qty_pcs: int | None,
    *,
    is_express: bool,
    express_multiplier: float,
) -> PricedItem:
    priced = price_regular(item, weight_kg, qty_pcs)
    if not is_express:
        return priced
    return replace(priced, subtotal=apply_express(priced.subtotal, express_multiplier))


def quote(
    db: Session,
    requests: Sequence[ItemRequest],
    *,
    is_express: bool,
    express_multiplier: float,
) -> Quote:
    if not requests:
        raise PricingError("Pesanan harus berisi minimal satu item")
    codes = {r.catalog_code for r in requests}
    catalog = {
        c.code: c for c in db.scalars(select(ServiceCatalog).where(ServiceCatalog.code.in_(codes)))
    }
    items = []
    for r in requests:
        entry = catalog.get(r.catalog_code)
        if entry is None or not entry.is_active:
            raise PricingError(f"Layanan {r.catalog_code} tidak tersedia")
        items.append(
            price_item(
                entry,
                r.weight_kg,
                r.qty_pcs,
                is_express=is_express,
                express_multiplier=express_multiplier,
            )
        )
    return Quote(
        items=items,
        total=sum(i.subtotal for i in items),
        is_express=is_express,
        express_multiplier=express_multiplier,
    )
