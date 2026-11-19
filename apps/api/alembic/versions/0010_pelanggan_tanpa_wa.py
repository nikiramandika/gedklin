"""pelanggan tanpa WhatsApp

- customers.has_whatsapp: False berarti nomor hanya untuk ditelepon; tidak ada WA yang dikirim.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0010'
down_revision: Union[str, Sequence[str], None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'customers',
        sa.Column('has_whatsapp', sa.Boolean(), server_default=sa.true(), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('customers', 'has_whatsapp')
