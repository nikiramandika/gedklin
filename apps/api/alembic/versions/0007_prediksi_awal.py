"""prediksi awal untuk mengukur akurasi ETA

- orders.initial_predicted_ready_at: perkiraan siap saat nota dibuat (atau saat isi
  pesanan dikoreksi). predicted_ready_at bisa berubah karena antrean, jadi akurasi
  model di dasbor diukur dari kolom ini.
- Diisi dari prediction_logs pertama tiap pesanan; bila tidak ada, dari
  predicted_ready_at.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'orders', sa.Column('initial_predicted_ready_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(
        """
        UPDATE orders o
        SET initial_predicted_ready_at =
            o.received_at + make_interval(secs => p.predicted_hours * 3600)
        FROM (
            SELECT DISTINCT ON (order_id) order_id, predicted_hours
            FROM prediction_logs
            ORDER BY order_id, id
        ) p
        WHERE p.order_id = o.id
        """
    )
    op.execute(
        "UPDATE orders SET initial_predicted_ready_at = predicted_ready_at "
        "WHERE initial_predicted_ready_at IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('orders', 'initial_predicted_ready_at')
