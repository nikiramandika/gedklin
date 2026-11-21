"""role admin menjadi staff

- Role `admin` (hanya tindak lanjut) diganti `staff`: mengerjakan cucian lewat layar Antrean Cucian.
  Tindak lanjut pindah ke kasir. Akun admin lama otomatis menjadi staff.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-21 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0011'
down_revision: Union[str, Sequence[str], None] = '0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rename(old: str, new: str) -> None:
    if op.get_bind().dialect.name == 'postgresql':
        op.execute(f"ALTER TYPE role RENAME VALUE '{old}' TO '{new}'")
    else:
        op.execute(f"UPDATE users SET role = '{new}' WHERE role = '{old}'")


def upgrade() -> None:
    """Upgrade schema."""
    _rename('admin', 'staff')


def downgrade() -> None:
    """Downgrade schema."""
    _rename('staff', 'admin')
