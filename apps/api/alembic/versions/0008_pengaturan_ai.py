"""pengaturan AI untuk analisis laporan

- app_settings.value menjadi TEXT: API key AI disimpan terenkripsi (Fernet) dan
  hasilnya lebih panjang dari 100 karakter.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'app_settings', 'value', type_=sa.Text(), existing_type=sa.String(100), existing_nullable=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM app_settings WHERE key IN ('ai_provider', 'ai_model', 'ai_api_key')")
    op.alter_column(
        'app_settings', 'value', type_=sa.String(100), existing_type=sa.Text(), existing_nullable=False
    )
