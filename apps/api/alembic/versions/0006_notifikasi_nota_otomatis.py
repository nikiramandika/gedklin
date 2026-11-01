"""notifikasi nota digital otomatis (RECEIPT)

- notificationtype + 'RECEIPT': nota dikirim lewat gateway WA saat pesanan dibuat.
- Unique index parsial: satu nota otomatis per pesanan.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-01 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nilai enum baru harus di-commit dulu sebelum dipakai di index parsial di bawah.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'RECEIPT'")
    op.create_index(
        'uq_notifications_receipt_once',
        'notifications',
        ['order_id'],
        unique=True,
        postgresql_where=sa.text("type = 'RECEIPT'"),
        sqlite_where=sa.text("type = 'RECEIPT'"),
    )


def downgrade() -> None:
    """Downgrade schema. Nilai enum RECEIPT tidak bisa dihapus; barisnya dihapus."""
    op.drop_index(
        'uq_notifications_receipt_once',
        table_name='notifications',
        postgresql_where=sa.text("type = 'RECEIPT'"),
        sqlite_where=sa.text("type = 'RECEIPT'"),
    )
    op.execute("DELETE FROM notifications WHERE type = 'RECEIPT'")
