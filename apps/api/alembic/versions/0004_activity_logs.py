"""log aktivitas petugas

Mencatat siapa melakukan apa dan kapan: pesanan (terima, ubah status), layanan
dan harga, akun, pengaturan, janji waktu, operasional harian, dan login.
Siapa yang menerima pesanan dan mengubah status sudah tercatat sebelumnya di
orders.created_by dan order_status_history.changed_by.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-13 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'activity_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('entity_type', sa.String(length=20), nullable=False),
        sa.Column('entity_id', sa.String(length=40), nullable=True),
        sa.Column('summary', sa.String(length=255), nullable=False),
        sa.Column('changes', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_activity_logs_user_id'), 'activity_logs', ['user_id'])
    op.create_index(op.f('ix_activity_logs_action'), 'activity_logs', ['action'])
    op.create_index(op.f('ix_activity_logs_entity_type'), 'activity_logs', ['entity_type'])
    op.create_index(op.f('ix_activity_logs_created_at'), 'activity_logs', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_activity_logs_created_at'), table_name='activity_logs')
    op.drop_index(op.f('ix_activity_logs_entity_type'), table_name='activity_logs')
    op.drop_index(op.f('ix_activity_logs_action'), table_name='activity_logs')
    op.drop_index(op.f('ix_activity_logs_user_id'), table_name='activity_logs')
    op.drop_table('activity_logs')
