from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CatalogGroup, CatalogUnit, Process, ServiceCatalog
from app.services.operations import MACHINE_CAPACITY_KG, count_loads, machine_loads


class PricingError(ValueError):
    pass


class CatalogLike(Protocol):
    code: str
    name: str
    group: CatalogGroup
    process: Process
    unit: CatalogUnit
    price: int | None
    extra_price: int | None
    base_kg: float | None
    min_qty: float | None
    kg_per_load: float | None
    pcs_per_load: int | None
    max_extra: float | None
    express_eligible: bool


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
    machine_loads: int | None
    extra_kg: int | None
    extra_pcs: int | None
    is_express: bool
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
    item: CatalogLike,
    weight_kg: float | None = None,
    qty_pcs: int | None = None,
    *,
    machine_capacity_kg: float = MACHINE_CAPACITY_KG,
) -> PricedItem:
    if item.price is None:
        raise PricingError(f"{item.name}: harga belum ditetapkan")
    loads = extra_kg = extra_pcs = None
    weight: float | None = None
    pcs: int | None = None
    extra_price = item.extra_price or 0
    max_extra = item.max_extra or 0

    if item.unit == CatalogUnit.KILOAN_7KG:
        weight = _need_weight(item, weight_kg)
        extra_kg = _ceil(max(0.0, weight - (item.base_kg or 7)))
        subtotal = item.price + extra_kg * extra_price
        loads = machine_loads(weight, machine_capacity_kg)
    elif item.unit == CatalogUnit.KG:
        weight = _need_weight(item, weight_kg)
        subtotal = _ceil(max(weight, item.min_qty or 0) * item.price)
    elif item.unit == CatalogUnit.PCS:
        pcs = _need_pcs(item, qty_pcs)
        subtotal = pcs * item.price
    elif item.kg_per_load:
        weight = _need_weight(item, weight_kg)
        loads = count_loads(weight, item.kg_per_load)
        pcs = int(qty_pcs or 0)
        if pcs < 0 or pcs > max_extra * loads:
            raise PricingError(
                f"{item.name}: tambahan maksimal {max_extra * loads:g} pcs untuk {loads} load"
            )
        extra_pcs = pcs
        subtotal = loads * item.price + extra_pcs * extra_price
    elif item.pcs_per_load:
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
        machine_loads=loads,
        extra_kg=extra_kg,
        extra_pcs=extra_pcs,
        is_express=False,
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
    machine_capacity_kg: float = MACHINE_CAPACITY_KG,
) -> PricedItem:
    priced = price_regular(item, weight_kg, qty_pcs, machine_capacity_kg=machine_capacity_kg)
    if not (is_express and item.express_eligible):
        return priced
    return replace(
        priced, is_express=True, subtotal=apply_express(priced.subtotal, express_multiplier)
    )


def quote(
    db: Session,
    requests: Sequence[ItemRequest],
    *,
    is_express: bool,
    express_multiplier: float,
    machine_capacity_kg: float = MACHINE_CAPACITY_KG,
) -> Quote:
    if not requests:
        raise PricingError("Pesanan harus berisi minimal satu item")
    codes = {r.catalog_code for r in requests}
    catalog = {
        c.code: c for c in db.scalars(select(ServiceCatalog).where(ServiceCatalog.code.in_(codes)))
    }
    entries = []
    for r in requests:
        entry = catalog.get(r.catalog_code)
        if entry is None or not entry.is_active:
            raise PricingError(f"Layanan {r.catalog_code} tidak tersedia")
        entries.append(entry)
    if is_express and not any(e.express_eligible for e in entries):
        eligible = db.scalars(
            select(ServiceCatalog.name)
            .where(ServiceCatalog.express_eligible.is_(True), ServiceCatalog.is_active.is_(True))
            .order_by(ServiceCatalog.sort_order)
        )
        raise PricingError(
            "Express hanya bisa dipilih bila pesanan berisi " + " atau ".join(eligible)
        )
    items = [
        price_item(
            entry,
            r.weight_kg,
            r.qty_pcs,
            is_express=is_express,
            express_multiplier=express_multiplier,
            machine_capacity_kg=machine_capacity_kg,
        )
        for r, entry in zip(requests, entries, strict=True)
    ]
    return Quote(
        items=items,
        total=sum(i.subtotal for i in items),
        is_express=is_express,
        express_multiplier=express_multiplier,
    )
