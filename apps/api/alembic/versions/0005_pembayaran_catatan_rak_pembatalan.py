"""pembayaran, catatan, rak, dan pembatalan pesanan

- orders.notes: kondisi barang / permintaan khusus.
- orders.rack_location: lokasi rak saat siap diambil.
- orders.payment_method + paid_at: pencatatan pembayaran di konter (bukan online).
  Pesanan lama yang sudah diambil dianggap lunas tunai saat diambil.
- Status CANCELLED + orders.cancelled_at, cancel_reason.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-13 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

payment_enum = sa.Enum('CASH', 'QRIS', 'TRANSFER', name='paymentmethod')


def upgrade() -> None:
    """Upgrade schema."""
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'CANCELLED'")
    payment_enum.create(op.get_bind(), checkfirst=True)
    op.add_column('orders', sa.Column('notes', sa.Text(), nullable=True))
    op.add_column('orders', sa.Column('rack_location', sa.String(length=20), nullable=True))
    op.add_column('orders', sa.Column('payment_method', payment_enum, nullable=True))
    op.add_column('orders', sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('orders', sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('orders', sa.Column('cancel_reason', sa.String(length=255), nullable=True))
    # Sebelum fitur ini, cucian diserahkan setelah dibayar.
    op.execute(
        "UPDATE orders SET payment_method = 'CASH', paid_at = picked_up_at "
        "WHERE status = 'PICKED_UP'"
    )


def downgrade() -> None:
    """Downgrade schema. Nilai enum CANCELLED tidak bisa dihapus; pesanan batal dihapus."""
    op.execute(
        "DELETE FROM order_status_history WHERE order_id IN "
        "(SELECT id FROM orders WHERE status = 'CANCELLED') OR to_status = 'CANCELLED'"
    )
    for table in ('order_items', 'notifications', 'prediction_logs'):
        op.execute(
            f"DELETE FROM {table} WHERE order_id IN (SELECT id FROM orders WHERE status = 'CANCELLED')"
        )
    op.execute("DELETE FROM orders WHERE status = 'CANCELLED'")
    for column in ('cancel_reason', 'cancelled_at', 'paid_at', 'payment_method', 'rack_location', 'notes'):
        op.drop_column('orders', column)
    payment_enum.drop(op.get_bind(), checkfirst=True)
