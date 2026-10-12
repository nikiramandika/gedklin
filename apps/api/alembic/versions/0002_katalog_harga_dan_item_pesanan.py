"""katalog harga dan item pesanan

- Tabel services (CK/CKS per kg) diganti service_catalog dari price list mitra.
- Pesanan berisi banyak item (order_items); orders.service_type dan weight_kg
  dipindah menjadi satu item per pesanan lama.
- Status disederhanakan: WASHING/DRYING/IRONING -> PROCESSING.
- Tabel pengaturan: service_promise (janji waktu) dan app_settings.
- daily_operations mencatat is_open, washers_available, dryers_available.
- Harga dalam Rupiah integer, prediksi dalam jam.

Katalog lengkap, janji waktu, dan pengaturan diisi oleh `python -m app.seed`.
Migrasi ini hanya mengisi item katalog yang dirujuk pesanan lama.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-12 19:24:57.689737

"""
import json
import math
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CATALOG_FILE = Path(__file__).resolve().parents[2] / "seed" / "price_catalog.json"
OLD_STATUSES = ("RECEIVED", "WASHING", "DRYING", "IRONING", "READY", "PICKED_UP")
NEW_STATUSES = ("RECEIVED", "PROCESSING", "READY", "PICKED_UP")
STATUS_COLUMNS = (
    ("orders", "status"),
    ("order_status_history", "from_status"),
    ("order_status_history", "to_status"),
)

group_enum = sa.Enum('KILOAN', 'SETRIKA', 'KHUSUS', 'SATUAN', name='cataloggroup')
process_enum = sa.Enum('C', 'CK', 'CKL', 'CKS', 'S', 'SATUAN', name='process')
unit_enum = sa.Enum('LOAD_7KG', 'KG', 'PCS', 'LOAD', name='catalogunit')

# Definisi tabel dibekukan di sini (bukan model aplikasi) agar migrasi tetap jalan
# walau model berubah di masa depan.
catalog_table = sa.table(
    'service_catalog',
    sa.column('code', sa.String),
    sa.column('name', sa.String),
    sa.column('group', group_enum),
    sa.column('process', process_enum),
    sa.column('unit', unit_enum),
    sa.column('price', sa.Integer),
    sa.column('extra_price', sa.Integer),
    sa.column('kg_per_load', sa.Float),
    sa.column('max_extra', sa.Float),
    sa.column('sort_order', sa.Integer),
    sa.column('is_active', sa.Boolean),
)
items_table = sa.table(
    'order_items',
    sa.column('order_id', sa.Integer),
    sa.column('catalog_code', sa.String),
    sa.column('name', sa.String),
    sa.column('group', group_enum),
    sa.column('process', process_enum),
    sa.column('weight_kg', sa.Float),
    sa.column('loads', sa.Integer),
    sa.column('extra_kg', sa.Integer),
    sa.column('subtotal', sa.Integer),
)


def _set_status_enum(values: tuple[str, ...], mapping: dict[str, str]) -> None:
    """Ganti isi enum orderstatus. Postgres tidak bisa menghapus nilai enum langsung."""
    for table, column in STATUS_COLUMNS:
        op.execute(f'ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR(20)')
    for old, new in mapping.items():
        for table, column in STATUS_COLUMNS:
            op.execute(f"UPDATE {table} SET {column} = '{new}' WHERE {column} = '{old}'")
    op.execute('DROP TYPE orderstatus')
    sa.Enum(*values, name='orderstatus').create(op.get_bind())
    for table, column in STATUS_COLUMNS:
        op.execute(
            f'ALTER TABLE {table} ALTER COLUMN {column} TYPE orderstatus '
            f'USING {column}::orderstatus'
        )


def _migrate_orders_to_items() -> None:
    bind = op.get_bind()
    orders = bind.execute(
        sa.text('SELECT id, service_type, weight_kg, price_total FROM orders')
    ).all()
    if not orders:
        return
    kiloan = {e['code']: e for e in json.loads(CATALOG_FILE.read_text(encoding='utf-8'))['kiloan']}
    used = sorted({o.service_type for o in orders})
    op.bulk_insert(
        catalog_table,
        [
            {
                'code': code,
                'name': kiloan[code]['name'],
                'group': 'KILOAN',
                'process': kiloan[code]['process'],
                'unit': 'LOAD_7KG',
                'price': kiloan[code]['price'],
                'extra_price': kiloan[code]['extra_price_per_kg'],
                'kg_per_load': 7.0,
                'max_extra': kiloan[code]['max_extra_kg'],
                'sort_order': i,
                'is_active': True,
            }
            for i, code in enumerate(used, start=1)
        ],
    )
    rows = []
    for o in orders:
        weight = float(o.weight_kg)
        loads = max(1, math.ceil(round((weight - 1) / 7, 9)))
        rows.append(
            {
                'order_id': o.id,
                'catalog_code': o.service_type,
                'name': kiloan[o.service_type]['name'],
                'group': 'KILOAN',
                'process': o.service_type,
                'weight_kg': weight,
                'loads': loads,
                'extra_kg': math.ceil(round(max(0.0, weight - 7 * loads), 6)),
                # Harga lama per kg dipertahankan apa adanya.
                'subtotal': int(round(float(o.price_total))),
            }
        )
    op.bulk_insert(items_table, rows)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('app_settings',
    sa.Column('key', sa.String(length=50), nullable=False),
    sa.Column('value', sa.String(length=100), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('service_catalog',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('group', group_enum, nullable=False),
    sa.Column('process', process_enum, nullable=False),
    sa.Column('unit', unit_enum, nullable=False),
    sa.Column('price', sa.Integer(), nullable=False),
    sa.Column('extra_price', sa.Integer(), nullable=True),
    sa.Column('min_qty', sa.Float(), nullable=True),
    sa.Column('kg_per_load', sa.Float(), nullable=True),
    sa.Column('pcs_per_load', sa.Integer(), nullable=True),
    sa.Column('max_extra', sa.Float(), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('service_promise',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('process', process_enum, nullable=False),
    sa.Column('regular_hours', sa.Integer(), nullable=True),
    sa.Column('express_hours', sa.Integer(), nullable=True),
    sa.Column('min_regular_hours', sa.Integer(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('process')
    )
    op.create_table('order_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('catalog_code', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('group', group_enum, nullable=False),
    sa.Column('process', process_enum, nullable=False),
    sa.Column('weight_kg', sa.Float(), nullable=True),
    sa.Column('qty_pcs', sa.Integer(), nullable=True),
    sa.Column('loads', sa.Integer(), nullable=True),
    sa.Column('extra_kg', sa.Integer(), nullable=True),
    sa.Column('extra_pcs', sa.Integer(), nullable=True),
    sa.Column('subtotal', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['catalog_code'], ['service_catalog.code'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_order_items_order_id'), 'order_items', ['order_id'], unique=False)

    _migrate_orders_to_items()
    _set_status_enum(
        NEW_STATUSES, {'WASHING': 'PROCESSING', 'DRYING': 'PROCESSING', 'IRONING': 'PROCESSING'}
    )
    # WASHING -> DRYING -> IRONING kini menjadi PROCESSING -> PROCESSING: buang yang ganda.
    op.execute('DELETE FROM order_status_history WHERE from_status = to_status')

    op.drop_column('orders', 'service_type')
    op.drop_column('orders', 'weight_kg')
    op.drop_table('services')
    op.execute('DROP TYPE servicetype')

    op.add_column('daily_operations', sa.Column('is_open', sa.Boolean(), server_default=sa.text('true'), nullable=False))
    op.add_column('daily_operations', sa.Column('washers_available', sa.Integer(), server_default='4', nullable=False))
    op.add_column('daily_operations', sa.Column('dryers_available', sa.Integer(), server_default='3', nullable=False))
    op.add_column('orders', sa.Column('promised_ready_at', sa.DateTime(timezone=True), nullable=True))
    op.alter_column('orders', 'price_total',
               existing_type=sa.NUMERIC(precision=12, scale=2),
               type_=sa.Integer(),
               existing_nullable=False,
               postgresql_using='round(price_total)::integer')

    op.add_column('prediction_logs', sa.Column('predicted_hours', sa.Float(), nullable=True))
    op.execute('UPDATE prediction_logs SET predicted_hours = predicted_minutes / 60.0')
    op.alter_column('prediction_logs', 'predicted_hours', nullable=False)
    op.drop_column('prediction_logs', 'predicted_minutes')


def downgrade() -> None:
    """Downgrade schema. Item selain kiloan CK/CKS tidak bisa dikembalikan."""
    op.add_column('prediction_logs', sa.Column('predicted_minutes', sa.DOUBLE_PRECISION(precision=53), nullable=True))
    op.execute('UPDATE prediction_logs SET predicted_minutes = predicted_hours * 60')
    op.alter_column('prediction_logs', 'predicted_minutes', nullable=False)
    op.drop_column('prediction_logs', 'predicted_hours')

    servicetype = postgresql.ENUM('CK', 'CKS', name='servicetype')
    servicetype.create(op.get_bind())
    op.create_table('services',
    sa.Column('id', sa.INTEGER(), autoincrement=True, nullable=False),
    sa.Column('code', postgresql.ENUM('CK', 'CKS', name='servicetype', create_type=False), autoincrement=False, nullable=False),
    sa.Column('name', sa.VARCHAR(length=100), autoincrement=False, nullable=False),
    sa.Column('price_per_kg_regular', sa.NUMERIC(precision=10, scale=2), autoincrement=False, nullable=False),
    sa.Column('price_per_kg_express', sa.NUMERIC(precision=10, scale=2), autoincrement=False, nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('services_pkey')),
    sa.UniqueConstraint('code', name=op.f('services_code_key'))
    )
    op.add_column('orders', sa.Column('weight_kg', sa.DOUBLE_PRECISION(precision=53), nullable=True))
    op.add_column('orders', sa.Column('service_type', postgresql.ENUM('CK', 'CKS', name='servicetype', create_type=False), nullable=True))
    op.execute(
        "UPDATE orders o SET "
        "weight_kg = COALESCE((SELECT SUM(i.weight_kg) FROM order_items i "
        "WHERE i.order_id = o.id AND i.\"group\" IN ('KILOAN', 'SETRIKA')), 0), "
        "service_type = CASE WHEN EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id "
        "AND i.process IN ('CKS', 'S')) THEN 'CKS'::servicetype ELSE 'CK'::servicetype END"
    )
    op.alter_column('orders', 'weight_kg', nullable=False)
    op.alter_column('orders', 'service_type', nullable=False)
    op.alter_column('orders', 'price_total',
               existing_type=sa.Integer(),
               type_=sa.NUMERIC(precision=12, scale=2),
               existing_nullable=False)
    op.drop_column('orders', 'promised_ready_at')
    op.drop_column('daily_operations', 'dryers_available')
    op.drop_column('daily_operations', 'washers_available')
    op.drop_column('daily_operations', 'is_open')

    _set_status_enum(OLD_STATUSES, {'PROCESSING': 'WASHING'})

    op.drop_index(op.f('ix_order_items_order_id'), table_name='order_items')
    op.drop_table('order_items')
    op.drop_table('service_promise')
    op.drop_table('service_catalog')
    op.drop_table('app_settings')
    for name in ('cataloggroup', 'process', 'catalogunit'):
        sa.Enum(name=name).drop(op.get_bind(), checkfirst=True)
