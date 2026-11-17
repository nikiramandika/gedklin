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
from gedklin_ml.features import MACHINE_CAPACITY_KG

CATALOG_PATH = Path(__file__).resolve().parents[1] / "seed" / "price_catalog.json"
SECTIONS = ("kiloan", "khusus", "satuan", "dry_clean")
SECTION_GROUP = {
    "khusus": CatalogGroup.KHUSUS,
    "satuan": CatalogGroup.SATUAN,
    "dry_clean": CatalogGroup.DRY_CLEAN,
}


def load_catalog_file(path: Path = CATALOG_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def catalog_rows(data: dict[str, Any]) -> list[ServiceCatalog]:
    rows: list[ServiceCatalog] = []
    entries = [(section, e) for section in SECTIONS for e in data.get(section, [])]
    for order, (section, e) in enumerate(entries, start=1):
        process = Process(e.get("process", "SATUAN"))
        unit = CatalogUnit(e.get("unit", "PCS"))
        if section == "kiloan":
            group = CatalogGroup.SETRIKA if process == Process.S else CatalogGroup.KILOAN
        else:
            group = SECTION_GROUP[section]
        price = e.get("price")
        rows.append(
            ServiceCatalog(
                code=e["code"],
                name=e["name"],
                group=group,
                process=process,
                unit=unit,
                price=None if price is None else int(price),
                extra_price=e.get("extra_price_per_kg", e.get("extra_price_per_pcs")),
                base_kg=e.get("base_kg"),
                min_qty=e.get("min_qty"),
                kg_per_load=e.get("max_kg_per_load"),
                # min/maks pcs per load dibaca sebagai isi satu load (menunggu konfirmasi mitra).
                pcs_per_load=e.get("max_pcs_per_load", e.get("min_pcs_per_load")),
                max_extra=e.get("max_extra_pcs"),
                express_eligible=bool(e.get("express_eligible", False)),
                sort_order=order,
                is_active=price is not None,
            )
        )
    return rows


def promise_rows(data: dict[str, Any]) -> list[ServicePromise]:
    promise = data["promise_hours"]
    minimum = promise.get("regular_min", {})
    eligible = {e["process"] for e in data["kiloan"] if e.get("express_eligible")}
    return [
        ServicePromise(
            process=Process(process),
            regular_hours=hours,
            express_hours=promise.get("express") if process in eligible else None,
            min_regular_hours=minimum.get(process),
        )
        for process, hours in promise["regular"].items()
    ]


def setting_values(data: dict[str, Any]) -> dict[str, str]:
    values = {
        "express_multiplier": f"{data['express_multiplier']:g}",
        "machine_capacity_kg": f"{data.get('machine_capacity_kg', MACHINE_CAPACITY_KG):g}",
    }
    if data["promise_hours"].get("default") is not None:
        values["default_promise_hours"] = f"{data['promise_hours']['default']:g}"
    return values


def seed_reference_data(db: Session, data: dict[str, Any] | None = None) -> list[str]:
    data = data or load_catalog_file()
    log: list[str] = []
    if db.scalar(select(ServiceCatalog.id).limit(1)) is None:
        for row in catalog_rows(data):
            db.add(row)
            log.append(f"Katalog {row.code} dibuat")
    else:
        log.append("Katalog sudah ada, dikelola dari dasbor (tidak diubah)")
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
