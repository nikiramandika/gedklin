"""riwayat analisis AI

- ai_analyses: hasil tiap analisis AI (periode, pertanyaan, jawaban, model, pembuat)
  supaya bisa dibuka lagi tanpa memanggil penyedia AI.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-18 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('ai_analyses',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('period_start', sa.Date(), nullable=False),
    sa.Column('period_end', sa.Date(), nullable=False),
    sa.Column('question', sa.Text(), nullable=True),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('model', sa.String(length=100), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ai_analyses_created_at'), 'ai_analyses', ['created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_ai_analyses_created_at'), table_name='ai_analyses')
    op.drop_table('ai_analyses')
