from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CatalogGroup, CatalogUnit, OrderItem, Process, ServiceCatalog

KILOAN_PROCESSES = (Process.C, Process.CK, Process.CKL, Process.CKS)

GROUP_RULES: dict[CatalogGroup, tuple[tuple[Process, ...], tuple[CatalogUnit, ...]]] = {
    CatalogGroup.KILOAN: (KILOAN_PROCESSES, (CatalogUnit.KILOAN_7KG,)),
    CatalogGroup.SETRIKA: ((Process.S,), (CatalogUnit.KG,)),
    CatalogGroup.KHUSUS: (KILOAN_PROCESSES, (CatalogUnit.PCS, CatalogUnit.KG, CatalogUnit.LOAD)),
    CatalogGroup.SATUAN: ((Process.SATUAN,), (CatalogUnit.PCS,)),
    CatalogGroup.DRY_CLEAN: ((Process.DRY_CLEAN,), (CatalogUnit.PCS,)),
}

DEFAULT_BASE_KG = 7.0


class CatalogError(ValueError):
    pass


def normalize(item: ServiceCatalog) -> None:
    processes, units = GROUP_RULES[item.group]
    if item.process not in processes:
        raise CatalogError("Proses tidak cocok dengan kelompok layanan")
    if item.unit not in units:
        raise CatalogError("Satuan harga tidak cocok dengan kelompok layanan")
    if item.price is None and item.is_active:
        raise CatalogError("Isi harga dulu sebelum mengaktifkan layanan")
    if item.express_eligible and item.unit != CatalogUnit.KILOAN_7KG:
        raise CatalogError("Express hanya bisa untuk layanan kiloan")

    if item.unit == CatalogUnit.KILOAN_7KG:
        item.base_kg = item.base_kg or DEFAULT_BASE_KG
        item.extra_price = item.extra_price or 0
        item.kg_per_load = item.pcs_per_load = item.max_extra = None
    elif item.unit == CatalogUnit.LOAD:
        if bool(item.kg_per_load) == bool(item.pcs_per_load):
            raise CatalogError("Isi kapasitas per load: per pcs atau per kg (salah satu)")
        item.base_kg = None
    else:
        item.base_kg = item.kg_per_load = item.pcs_per_load = item.max_extra = None
        item.extra_price = None
    if item.unit == CatalogUnit.PCS:
        item.min_qty = None


def next_sort_order(db: Session) -> int:
    return int(db.scalar(select(func.max(ServiceCatalog.sort_order))) or 0) + 1


def usage_count(db: Session, code: str) -> int:
    return int(
        db.scalar(select(func.count(OrderItem.id)).where(OrderItem.catalog_code == code)) or 0
    )
