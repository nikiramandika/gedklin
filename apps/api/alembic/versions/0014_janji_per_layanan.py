"""janji per layanan

- service_catalog.promise_hours / express_promise_hours: janji siap per item katalog, supaya
  boneka, gordyn, dan kemeja bisa punya janji berbeda walau prosesnya sama.
- Isi awal disalin dari janji per proses (service_promise). Janji Express hanya untuk layanan
  yang bisa Express.
- Tabel service_promise dihapus. Batas bawah janji (min_regular_hours) tidak pernah dipakai
  dalam hitungan, jadi tidak dipindahkan.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-24 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: Union[str, Sequence[str], None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROCESSES = ('C', 'CK', 'CKL', 'CKS', 'S', 'SATUAN', 'DRY_CLEAN')


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('service_catalog', sa.Column('promise_hours', sa.Integer(), nullable=True))
    op.add_column(
        'service_catalog', sa.Column('express_promise_hours', sa.Integer(), nullable=True)
    )
    op.execute(
        """
        UPDATE service_catalog SET
            promise_hours = (
                SELECT sp.regular_hours FROM service_promise sp
                WHERE sp.process = service_catalog.process
            ),
            express_promise_hours = CASE WHEN service_catalog.express_eligible THEN (
                SELECT sp.express_hours FROM service_promise sp
                WHERE sp.process = service_catalog.process
            ) END
        """
    )
    op.drop_table('service_promise')


def downgrade() -> None:
    """Downgrade schema."""
    process_enum = postgresql.ENUM(*PROCESSES, name='process', create_type=False)
    op.create_table(
        'service_promise',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('process', process_enum, nullable=False),
        sa.Column('regular_hours', sa.Integer(), nullable=True),
        sa.Column('express_hours', sa.Integer(), nullable=True),
        sa.Column('min_regular_hours', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('process'),
    )
    # Janji per proses dikembalikan dari janji terlama layanan dengan proses itu.
    op.execute(
        """
        INSERT INTO service_promise (process, regular_hours, express_hours)
        SELECT process, MAX(promise_hours), MAX(express_promise_hours)
        FROM service_catalog GROUP BY process
        """
    )
    op.drop_column('service_catalog', 'express_promise_hours')
    op.drop_column('service_catalog', 'promise_hours')
