"""data waktu dari mitra + lama kerja per pesanan

- service_catalog.work_per_order: lama kerja berlaku sekali per pesanan, bukan dikali jumlah.
  Dipakai untuk layanan berhitungan hari (gordyn 2 hari). Kiloan "per 7 kg" dihitung per putaran
  mesin, tidak memakai kolom ini.
- Mengisi janji Reguler/Express dan lama kerja semua layanan dari tabel mitra (26 Nov 2026).
  1 hari janji = 24 jam kalender; 1 hari lama kerja = 9 jam kerja (08.00-17.00) = 540 menit.
- Cuci + Kering (CK) kini bisa Express (janji 3 jam).

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-26 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0015'
down_revision: Union[str, Sequence[str], None] = '0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# code: (janji Reguler jam, janji Express jam, lama kerja menit, per pesanan)
PARTNER = {
    'CK': (48, 3, 120, False),
    'C': (24, None, 45, False),
    'CKL': (72, 3, 180, False),
    'CKS': (72, 4, 180, False),
    'SETRIKA': (48, None, 9, False),
    'BEDCOVER_K': (48, None, 540, True),
    'BEDCOVER_B': (48, None, 540, True),
    'GORDYN': (48, None, 1080, True),
    'JAKET': (72, None, 1080, True),
    'SELIMUT_K': (48, None, 120, False),
    'SELIMUT_B': (48, None, 540, True),
    'SPREI_K': (48, None, 180, False),
    'SPREI_B_RIMPLE': (48, None, 180, False),
    'SPREI_B_NONRIMPLE': (48, None, 180, False),
    'BONEKA_S': (72, None, 240, False),
    'BONEKA_M': (72, None, 240, False),
    'BONEKA_L': (72, None, 240, False),
    'CELANA_BAHAN': (24, None, 60, False),
    'CELANA_JEANS': (24, None, 60, False),
    'GAMIS_RINGAN': (24, None, 60, False),
    'GAMIS_BERAT': (24, None, 60, False),
    'GAUN_NONPAYET': (48, None, 120, False),
    'GAUN_PAYET': (48, None, 120, False),
    'KAOS_OBLONG': (24, None, 60, False),
    'KAOS_BERKERAH': (24, None, 60, False),
    'KEMEJA_PENDEK': (24, None, 60, False),
    'KEMEJA_PANJANG': (24, None, 60, False),
    'KHIMAR_M': (48, None, 120, False),
    'KHIMAR_L': (48, None, 120, False),
    'KHIMAR_XL': (48, None, 120, False),
    'DC_SONGKET': (24, None, 120, False),
    'DC_KAIN_TENUN': (24, None, 120, False),
    'DC_KEBAYA_PAYET': (24, None, 120, False),
}


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'service_catalog',
        sa.Column('work_per_order', sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    catalog = sa.table(
        'service_catalog',
        sa.column('code', sa.String),
        sa.column('promise_hours', sa.Integer),
        sa.column('express_promise_hours', sa.Integer),
        sa.column('express_eligible', sa.Boolean),
        sa.column('work_minutes', sa.Float),
        sa.column('work_per_order', sa.Boolean),
    )
    for code, (regular, express, minutes, per_order) in PARTNER.items():
        values = {
            'promise_hours': regular,
            'express_promise_hours': express,
            'work_minutes': minutes,
            'work_per_order': per_order,
        }
        if express is not None:
            values['express_eligible'] = True
        op.execute(catalog.update().where(catalog.c.code == code).values(**values))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('service_catalog', 'work_per_order')
