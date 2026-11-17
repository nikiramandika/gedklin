import csv
import io
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Order, OrderStatus, Role, User
from app.schemas import ReportDay, ReportOut, ReportRow
from app.security import require_roles
from app.services.notifications import describe_item
from app.services.orders import PAYMENT_LABEL, STATUS_LABEL
from gedklin_ml.features import LOCAL_TZ, to_local

router = APIRouter(prefix="/reports", tags=["reports"])
owner = require_roles(Role.OWNER)
MAX_DAYS = 366


def _range(start: date | None, end: date | None) -> tuple[date, date]:
    today = datetime.now(LOCAL_TZ).date()
    end = end or today
    start = start or end - timedelta(days=6)
    if start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Tanggal awal setelah akhir")
    if (end - start).days >= MAX_DAYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Periode maksimal 1 tahun")
    return start, end


def _orders(db: Session, start: date, end: date) -> list[Order]:
    lo = datetime.combine(start, time.min, tzinfo=LOCAL_TZ)
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
    stmt = (
        select(Order)
        .where(Order.received_at >= lo, Order.received_at < hi)
        .order_by(Order.received_at)
    )
    return list(db.scalars(stmt).unique())


def _rows(groups: dict[str, dict], labels: dict[str, str]) -> list[ReportRow]:
    rows = [
        ReportRow(
            key=key,
            label=labels.get(key, key),
            orders=len(g["orders"]),
            revenue=g["revenue"],
            weight_kg=round(g["kg"], 2),
            qty_pcs=g["pcs"],
        )
        for key, g in groups.items()
    ]
    return sorted(rows, key=lambda r: r.revenue, reverse=True)


def _group() -> dict:
    return {"orders": set(), "revenue": 0, "kg": 0.0, "pcs": 0}


@router.get("/summary", response_model=ReportOut)
def summary(
    db: Session = Depends(get_db),
    _: User = Depends(owner),
    start: date | None = Query(default=None, description="Tanggal awal (WIB), default 7 hari"),
    end: date | None = Query(default=None, description="Tanggal akhir (WIB), default hari ini"),
) -> ReportOut:
    start, end = _range(start, end)
    orders = _orders(db, start, end)
    valid = [o for o in orders if o.status != OrderStatus.CANCELLED]

    per_day: dict[date, list[Order]] = defaultdict(list)
    service: dict[str, dict] = defaultdict(_group)
    service_label: dict[str, str] = {}
    cashier: dict[str, dict] = defaultdict(_group)
    cashier_label: dict[str, str] = {}
    payment: dict[str, dict] = defaultdict(_group)
    payment_label = {m.value: label for m, label in PAYMENT_LABEL.items()} | {
        "UNPAID": "Belum lunas"
    }

    for o in valid:
        per_day[to_local(o.received_at).date()].append(o)
        for item in o.items:
            g = service[item.catalog_code]
            service_label[item.catalog_code] = item.name
            g["orders"].add(o.id)
            g["revenue"] += item.subtotal
            g["kg"] += item.weight_kg or 0
            g["pcs"] += item.qty_pcs or 0
        key = str(o.created_by or 0)
        cashier_label[key] = o.created_by_name or "Tanpa nama"
        cashier[key]["orders"].add(o.id)
        cashier[key]["revenue"] += o.price_total
        pay_key = o.payment_method.value if o.is_paid and o.payment_method else "UNPAID"
        payment[pay_key]["orders"].add(o.id)
        payment[pay_key]["revenue"] += o.price_total

    revenue = sum(o.price_total for o in valid)
    paid = sum(o.price_total for o in valid if o.is_paid)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return ReportOut(
        start=start,
        end=end,
        orders=len(valid),
        revenue=revenue,
        weight_kg=round(sum(i.weight_kg or 0 for o in valid for i in o.items), 2),
        avg_order_value=round(revenue / len(valid)) if valid else 0,
        paid_total=paid,
        unpaid_total=revenue - paid,
        unpaid_orders=sum(1 for o in valid if not o.is_paid),
        cancelled_orders=len(orders) - len(valid),
        express_orders=sum(1 for o in valid if o.is_express),
        by_day=[
            ReportDay(
                date=d, orders=len(per_day[d]), revenue=sum(o.price_total for o in per_day[d])
            )
            for d in days
        ],
        by_service=_rows(service, service_label),
        by_cashier=_rows(cashier, cashier_label),
        by_payment=_rows(payment, payment_label),
    )


def _fmt_dt(dt: datetime | None) -> str:
    return to_local(dt).strftime("%Y-%m-%d %H:%M") if dt else ""


@router.get("/orders.csv")
def export_orders(
    db: Session = Depends(get_db),
    _: User = Depends(owner),
    start: date | None = None,
    end: date | None = None,
) -> Response:
    """Semua pesanan pada periode, termasuk yang dibatalkan. Siap dibuka di Excel."""
    start, end = _range(start, end)
    buf = io.StringIO()
    # Titik koma + BOM supaya Excel berbahasa Indonesia langsung memisah kolom.
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        [
            "Kode",
            "Diterima",
            "Kasir",
            "Pelanggan",
            "Isi pesanan",
            "Berat (kg)",
            "Express",
            "Total (Rp)",
            "Status",
            "Pembayaran",
            "Dibayar",
            "Siap",
            "Diambil",
            "Rak",
            "Catatan",
            "Alasan batal",
        ]
    )
    for o in _orders(db, start, end):
        kg = sum(i.weight_kg or 0 for i in o.items)
        writer.writerow(
            [
                o.tracking_code,
                _fmt_dt(o.received_at),
                o.created_by_name or "",
                o.customer.name,
                ", ".join(describe_item(i) for i in o.items),
                f"{kg:g}".replace(".", ","),
                "Ya" if o.is_express else "Tidak",
                o.price_total,
                STATUS_LABEL[o.status],
                PAYMENT_LABEL[o.payment_method]
                if o.is_paid and o.payment_method
                else "Belum lunas",
                _fmt_dt(o.paid_at),
                _fmt_dt(o.ready_at),
                _fmt_dt(o.picked_up_at),
                o.rack_location or "",
                o.notes or "",
                o.cancel_reason or "",
            ]
        )
    filename = f"pesanan-gedklin-{start.isoformat()}-sd-{end.isoformat()}.csv"
    return Response(
        content="﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
