"""Isi data awal: katalog harga mitra, janji waktu, pengaturan, dan akun owner.

python -m app.seed

Sumber kebenaran harga: seed/price_catalog.json. Item yang sudah ada tidak
ditimpa, supaya harga yang sudah diubah pemilik dari dasbor tetap aman.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    AppSetting,
    CatalogGroup,
    CatalogUnit,
    Process,
    Role,
    ServiceCatalog,
    ServicePromise,
    User,
)
from app.security import hash_password

CATALOG_PATH = Path(__file__).resolve().parents[1] / "seed" / "price_catalog.json"


def load_catalog_file(path: Path = CATALOG_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def catalog_rows(data: dict[str, Any]) -> list[ServiceCatalog]:
    """Ubah price_catalog.json menjadi baris service_catalog."""
    rows: list[ServiceCatalog] = []
    entries = (
        [("kiloan", e) for e in data["kiloan"]]
        + [("khusus", e) for e in data["khusus"]]
        + [("satuan", e) for e in data["satuan"]]
    )
    for order, (section, e) in enumerate(entries, start=1):
        process = Process(e.get("process", "SATUAN"))
        unit = CatalogUnit(e.get("unit", "PCS"))
        if section == "kiloan":
            group = CatalogGroup.SETRIKA if process == Process.S else CatalogGroup.KILOAN
        else:
            group = CatalogGroup.KHUSUS if section == "khusus" else CatalogGroup.SATUAN
        rows.append(
            ServiceCatalog(
                code=e["code"],
                name=e["name"],
                group=group,
                process=process,
                unit=unit,
                price=int(e["price"]),
                extra_price=e.get("extra_price_per_kg", e.get("extra_price_per_pcs")),
                min_qty=e.get("min_qty"),
                kg_per_load=7.0 if unit == CatalogUnit.LOAD_7KG else e.get("max_kg_per_load"),
                # "min 3 pcs/load" (selimut kecil) dan "maks 2 pcs/load" sama-sama
                # dibaca sebagai isi satu load; menunggu konfirmasi mitra.
                pcs_per_load=e.get("max_pcs_per_load", e.get("min_pcs_per_load")),
                max_extra=e.get("max_extra_kg", e.get("max_extra_pcs")),
                sort_order=order,
                is_active=True,
            )
        )
    return rows


def promise_rows(data: dict[str, Any]) -> list[ServicePromise]:
    promise = data["promise_hours"]
    minimum = promise.get("regular_min", {})
    return [
        ServicePromise(
            process=Process(process),
            regular_hours=hours,
            express_hours=promise.get("express"),
            min_regular_hours=minimum.get(process),
        )
        for process, hours in promise["regular"].items()
    ]


def setting_values(data: dict[str, Any]) -> dict[str, str]:
    return {
        "express_multiplier": f"{data['express_multiplier']:g}",
        "default_promise_hours": f"{data['promise_hours']['default']:g}",
    }


def seed_reference_data(db: Session, data: dict[str, Any] | None = None) -> list[str]:
    """Isi katalog, janji waktu, dan pengaturan yang belum ada. Kembalikan log."""
    data = data or load_catalog_file()
    log: list[str] = []
    existing = set(db.scalars(select(ServiceCatalog.code)))
    for row in catalog_rows(data):
        if row.code not in existing:
            db.add(row)
            log.append(f"Katalog {row.code} dibuat")
    promised = set(db.scalars(select(ServicePromise.process)))
    for row in promise_rows(data):
        if row.process not in promised:
            db.add(row)
            log.append(f"Janji waktu {row.process} dibuat")
    for key, value in setting_values(data).items():
        if db.get(AppSetting, key) is None:
            db.add(AppSetting(key=key, value=value))
            log.append(f"Pengaturan {key}={value} dibuat")
    return log


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        for line in seed_reference_data(db):
            print(line)

        username = settings.seed_owner_username
        if db.scalar(select(User).where(User.username == username)) is None:
            if not settings.seed_owner_password:
                raise SystemExit("Set SEED_OWNER_PASSWORD di .env sebelum seeding akun owner")
            db.add(
                User(
                    name="Pemilik",
                    username=username,
                    password_hash=hash_password(settings.seed_owner_password),
                    role=Role.OWNER,
                    is_active=True,
                )
            )
            print(f"Akun owner '{username}' dibuat")
        db.commit()


if __name__ == "__main__":
    main()
