"""hapus prediksi ML

- Perkiraan siap kini sama dengan janji layanan (orders.promised_ready_at), jadi kolom
  prediksi dan pemicu WA "perkiraan mundur" dihapus: predicted_ready_at,
  initial_predicted_ready_at, last_notified_eta, delay_notif_count.
- Tabel prediction_logs dihapus.
- Riwayat notifikasi DELAY lama tetap disimpan.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-23 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f("ix_prediction_logs_order_id"), table_name="prediction_logs")
    op.drop_table("prediction_logs")
    with op.batch_alter_table("orders") as batch:
        batch.drop_column("predicted_ready_at")
        batch.drop_column("initial_predicted_ready_at")
        batch.drop_column("last_notified_eta")
        batch.drop_column("delay_notif_count")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("orders") as batch:
        batch.add_column(
            sa.Column("delay_notif_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("last_notified_eta", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(
            sa.Column("initial_predicted_ready_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch.add_column(sa.Column("predicted_ready_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE orders SET predicted_ready_at = promised_ready_at, "
        "initial_predicted_ready_at = promised_ready_at, last_notified_eta = promised_ready_at"
    )
    op.create_table(
        "prediction_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("features_json", sa.JSON(), nullable=False),
        sa.Column("predicted_hours", sa.Float(), nullable=False),
        sa.Column("model_version", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_prediction_logs_order_id"), "prediction_logs", ["order_id"], unique=False
    )
