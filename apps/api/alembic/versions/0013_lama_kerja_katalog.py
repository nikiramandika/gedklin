"""lama kerja per item katalog

- service_catalog.work_minutes: lama kerja (menit) per satuan harga untuk penjadwalan LST.
  NULL = dihitung dari muatan mesin dan tarif di Pengaturan (kiloan).
- Item non-kiloan bawaan diisi taksiran awal supaya tidak terhitung 0 jam. Angka ini menunggu
  konfirmasi mitra dan bisa diubah di Layanan & Harga.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Sama dengan seed/price_catalog.json saat migrasi ini dibuat.
ESTIMATES = {
    'BEDCOVER_K': 150,
    'BEDCOVER_B': 180,
    'GORDYN': 20,
    'JAKET': 45,
    'BONEKA_S': 60,
    'BONEKA_M': 90,
    'BONEKA_L': 120,
    'CELANA_BAHAN': 15,
    'CELANA_JEANS': 20,
    'GAMIS_RINGAN': 20,
    'GAMIS_BERAT': 30,
    'GAUN_NONPAYET': 30,
    'GAUN_PAYET': 45,
    'KAOS_OBLONG': 10,
    'KAOS_BERKERAH': 12,
    'KEMEJA_PENDEK': 12,
    'KEMEJA_PANJANG': 15,
    'KHIMAR_M': 10,
    'KHIMAR_L': 12,
    'KHIMAR_XL': 15,
    'DC_SONGKET': 120,
    'DC_KAIN_TENUN': 120,
    'DC_KEBAYA_PAYET': 120,
}


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('service_catalog', sa.Column('work_minutes', sa.Float(), nullable=True))
    catalog = sa.table(
        'service_catalog', sa.column('code', sa.String), sa.column('work_minutes', sa.Float)
    )
    for code, minutes in ESTIMATES.items():
        op.execute(
            catalog.update()
            .where(catalog.c.code == code, catalog.c.work_minutes.is_(None))
            .values(work_minutes=minutes)
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('service_catalog', 'work_minutes')
