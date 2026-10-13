"""harga kiloan per kg, express CKL/CKS, dry clean

Penyesuaian dari mitra (13 Okt 2026):
- Kiloan: harga 7 kg pertama + tambahan per kg untuk sisa berat (tidak ada load
  kedua). Satuan LOAD_7KG diganti KILOAN_7KG, berat dasar disimpan di base_kg.
- Load operasional untuk fitur ML: order_items.loads -> machine_loads,
  kiloan = ceil(kg / 8).
- Express hanya untuk item express_eligible (CKL dan CKS). order_items.is_express
  mencatat item yang dikenai harga Express.
- Kelompok dan proses DRY_CLEAN. Harga dry clean belum diketahui, jadi
  service_catalog.price boleh NULL.
- Janji Express hanya untuk CKL dan CKS.

Item katalog baru (dry clean) dan pengaturan machine_capacity_kg diisi oleh
`python -m app.seed`. Subtotal pesanan lama tidak diubah.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-13 10:00:00.000000

"""
import json
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EXPRESS_PROCESSES = "('CKL', 'CKS')"
CATALOG_FILE = Path(__file__).resolve().parents[2] / "seed" / "price_catalog.json"


def upgrade() -> None:
    """Upgrade schema."""
    # Nilai enum baru harus di-commit dulu sebelum dipakai untuk item dry clean di bawah.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE process ADD VALUE IF NOT EXISTS 'DRY_CLEAN'")
        op.execute("ALTER TYPE cataloggroup ADD VALUE IF NOT EXISTS 'DRY_CLEAN'")
    op.execute("ALTER TYPE catalogunit RENAME VALUE 'LOAD_7KG' TO 'KILOAN_7KG'")

    op.add_column('service_catalog', sa.Column('base_kg', sa.Float(), nullable=True))
    op.add_column(
        'service_catalog',
        sa.Column('express_eligible', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.alter_column('service_catalog', 'price', existing_type=sa.Integer(), nullable=True)
    op.execute(
        "UPDATE service_catalog SET base_kg = COALESCE(kg_per_load, 7), "
        "kg_per_load = NULL, max_extra = NULL WHERE unit = 'KILOAN_7KG'"
    )
    op.execute(
        "UPDATE service_catalog SET express_eligible = true "
        f"WHERE unit = 'KILOAN_7KG' AND process IN {EXPRESS_PROCESSES}"
    )

    op.alter_column('order_items', 'loads', new_column_name='machine_loads')
    op.add_column(
        'order_items',
        sa.Column('is_express', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    # Pesanan lama: semua item pesanan Express dulu ikut dikali, jadi tetap ditandai Express.
    op.execute(
        "UPDATE order_items i SET is_express = o.is_express FROM orders o WHERE o.id = i.order_id"
    )
    op.execute(
        "UPDATE order_items SET machine_loads = CEIL(weight_kg / 8.0) "
        "WHERE \"group\" = 'KILOAN' AND weight_kg > 0"
    )

    op.execute(
        f"UPDATE service_promise SET express_hours = NULL WHERE process NOT IN {EXPRESS_PROCESSES}"
    )
    _add_dry_clean()


def _add_dry_clean() -> None:
    """Database yang katalognya sudah terisi: tambahkan item dry clean dari price list.

    Seed hanya mengisi katalog yang masih kosong, jadi item baru dimasukkan di sini.
    Harga belum diketahui, sehingga item dibuat nonaktif.
    """
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM service_catalog LIMIT 1")).first() is None:
        return
    data = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    order = bind.execute(sa.text("SELECT COALESCE(MAX(sort_order), 0) FROM service_catalog")).scalar()
    existing = set(bind.execute(sa.text("SELECT code FROM service_catalog")).scalars())
    for e in data.get("dry_clean", []):
        if e["code"] in existing:
            continue
        order += 1
        bind.execute(
            sa.text(
                'INSERT INTO service_catalog (code, name, "group", process, unit, price, '
                "express_eligible, sort_order, is_active) VALUES (:code, :name, 'DRY_CLEAN', "
                "'DRY_CLEAN', 'PCS', :price, false, :sort_order, :active)"
            ),
            {
                "code": e["code"],
                "name": e["name"],
                "price": e.get("price"),
                "sort_order": order,
                "active": e.get("price") is not None,
            },
        )
    if bind.execute(
        sa.text("SELECT 1 FROM service_promise WHERE process = 'DRY_CLEAN'")
    ).first() is None:
        hours = data["promise_hours"]["regular"].get("DRY_CLEAN")
        bind.execute(
            sa.text(
                "INSERT INTO service_promise (process, regular_hours) VALUES ('DRY_CLEAN', :hours)"
            ),
            {"hours": hours},
        )


def downgrade() -> None:
    """Downgrade schema. Nilai enum DRY_CLEAN tidak bisa dihapus dan dibiarkan."""
    op.execute("DELETE FROM service_promise WHERE process = 'DRY_CLEAN'")
    op.execute(
        "DELETE FROM order_items WHERE \"group\" = 'DRY_CLEAN' OR process = 'DRY_CLEAN'"
    )
    op.execute(
        "DELETE FROM service_catalog WHERE \"group\" = 'DRY_CLEAN' OR process = 'DRY_CLEAN'"
    )
    op.execute(
        "UPDATE order_items SET machine_loads = GREATEST(1, CEIL((weight_kg - 1) / 7.0)) "
        "WHERE \"group\" = 'KILOAN' AND weight_kg > 0"
    )
    op.drop_column('order_items', 'is_express')
    op.alter_column('order_items', 'machine_loads', new_column_name='loads')

    op.execute(
        "UPDATE service_catalog SET kg_per_load = COALESCE(base_kg, 7), max_extra = 1 "
        "WHERE unit = 'KILOAN_7KG'"
    )
    op.execute("UPDATE service_catalog SET price = 0 WHERE price IS NULL")
    op.alter_column('service_catalog', 'price', existing_type=sa.Integer(), nullable=False)
    op.drop_column('service_catalog', 'express_eligible')
    op.drop_column('service_catalog', 'base_kg')
    op.execute("ALTER TYPE catalogunit RENAME VALUE 'KILOAN_7KG' TO 'LOAD_7KG'")
