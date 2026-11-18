import csv
import io
import json
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AiAnalysis, Order, OrderStatus, Role, User
from app.schemas import AiAnalysisIn, AiAnalysisOut, ReportDay, ReportOut, ReportRow
from app.security import require_roles
from app.services.activity import log_activity
from app.services.ai import AiError, chat, load_ai_config
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


def _build(orders: list[Order], start: date, end: date) -> ReportOut:
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


@router.get("/summary", response_model=ReportOut)
def summary(
    db: Session = Depends(get_db),
    _: User = Depends(owner),
    start: date | None = Query(default=None, description="Tanggal awal (WIB), default 7 hari"),
    end: date | None = Query(default=None, description="Tanggal akhir (WIB), default hari ini"),
) -> ReportOut:
    start, end = _range(start, end)
    return _build(_orders(db, start, end), start, end)


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


WEEKDAY = ("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu")

AI_SYSTEM_PROMPT = """Kamu analis bisnis untuk Gedklin, laundry kiloan di Medan.
Pembacamu pemilik usaha: pakai Bahasa Indonesia yang lugas, tanpa istilah teknis.
Aturan:
- Pakai HANYA data JSON dari pengguna. Jangan mengarang angka, pelanggan, atau kejadian.
- Semua angka sudah dihitung sistem; kutip apa adanya, jangan menghitung ulang total.
- Uang dalam Rupiah (Rp150.000). Bila data terlalu sedikit untuk menyimpulkan, katakan.
- Format Markdown sederhana: judul "## ", poin "- ", tebal **...**. Tanpa tabel.
- Ringkas, paling banyak sekitar 300 kata."""

AI_DEFAULT_TASK = """Buat analisis laporan dengan bagian:
## Ringkasan
## Temuan penting (bandingkan dengan periode sebelumnya, pola hari/jam, layanan, ketepatan waktu)
## Saran tindakan (maksimal 5, konkret dan bisa dilakukan minggu ini)"""


def _totals(r: ReportOut) -> dict:
    return {
        "pesanan": r.orders,
        "pendapatan": r.revenue,
        "rata_rata_per_pesanan": r.avg_order_value,
        "berat_kg": r.weight_kg,
        "pesanan_express": r.express_orders,
        "dibatalkan": r.cancelled_orders,
        "belum_lunas_rp": r.unpaid_total,
        "pesanan_belum_lunas": r.unpaid_orders,
    }


def _breakdown(rows: list[ReportRow]) -> list[dict]:
    return [
        {"nama": r.label, "pesanan": r.orders, "pendapatan": r.revenue}
        | ({"berat_kg": r.weight_kg} if r.weight_kg else {})
        | ({"pcs": r.qty_pcs} if r.qty_pcs else {})
        for r in rows
    ]


def _timeliness(valid: list[Order]) -> dict:
    done = [o for o in valid if o.ready_at and o.promised_ready_at]
    late = [o for o in done if o.ready_at > o.promised_ready_at]
    late_hours = [(o.ready_at - o.promised_ready_at).total_seconds() / 3600 for o in late]

    def share(group: list[Order]) -> dict:
        g_late = [o for o in group if o.ready_at > o.promised_ready_at]
        return {"selesai": len(group), "terlambat": len(g_late)}

    return {
        "selesai_dengan_janji": len(done),
        "terlambat": len(late),
        "persen_tepat_waktu": round(100 * (len(done) - len(late)) / len(done), 1) if done else None,
        "rata_rata_terlambat_jam": round(sum(late_hours) / len(late_hours), 1) if late else 0,
        "reguler": share([o for o in done if not o.is_express]),
        "express": share([o for o in done if o.is_express]),
    }


def _ai_context(db: Session, start: date, end: date) -> dict:
    orders = _orders(db, start, end)
    report = _build(orders, start, end)
    valid = [o for o in orders if o.status != OrderStatus.CANCELLED]

    length = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)
    previous = _build(_orders(db, prev_start, prev_end), prev_start, prev_end)

    weekday: dict[str, dict] = {d: {"pesanan": 0, "pendapatan": 0} for d in WEEKDAY}
    for d in report.by_day:
        w = weekday[WEEKDAY[d.date.weekday()]]
        w["pesanan"] += d.orders
        w["pendapatan"] += d.revenue
    hours = Counter(to_local(o.received_at).hour for o in valid)
    reasons = Counter(
        (o.cancel_reason or "Tanpa alasan").strip()
        for o in orders
        if o.status == OrderStatus.CANCELLED
    )

    # Sengaja tanpa nama/nomor pelanggan: hanya angka agregat yang dikirim ke penyedia AI.
    return {
        "periode": {"mulai": start.isoformat(), "akhir": end.isoformat(), "jumlah_hari": length},
        "ringkasan": _totals(report),
        "periode_sebelumnya": {
            "mulai": prev_start.isoformat(),
            "akhir": prev_end.isoformat(),
            **_totals(previous),
        },
        "per_hari": [
            {
                "tanggal": d.date.isoformat(),
                "hari": WEEKDAY[d.date.weekday()],
                "pesanan": d.orders,
                "pendapatan": d.revenue,
            }
            for d in report.by_day
        ],
        "per_hari_dalam_minggu": weekday,
        "pesanan_masuk_per_jam": {f"{h:02d}:00": n for h, n in sorted(hours.items())},
        "per_layanan": _breakdown(report.by_service),
        "per_kasir": _breakdown(report.by_cashier),
        "per_metode_bayar": _breakdown(report.by_payment),
        "ketepatan_waktu": _timeliness(valid),
        "alasan_batal": dict(reasons.most_common(5)),
    }


@router.post("/ai-analysis", response_model=AiAnalysisOut, status_code=status.HTTP_201_CREATED)
def ai_analysis(
    data: AiAnalysisIn, db: Session = Depends(get_db), me: User = Depends(owner)
) -> AiAnalysis:
    config = load_ai_config(db)
    if not config.ready:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "API key AI belum diisi. Buka Pengaturan AI di halaman Analisis AI.",
        )
    start, end = _range(data.start, data.end)
    context = _ai_context(db, start, end)
    question = (data.question or "").strip() or None
    task = (
        f"Pertanyaan pemilik: {question}\nJawab pertanyaan itu berdasarkan data."
        if question
        else AI_DEFAULT_TASK
    )
    prompt = f"{task}\n\nData laporan (JSON):\n{json.dumps(context, ensure_ascii=False)}"
    try:
        text = chat(config, AI_SYSTEM_PROMPT, prompt)
    except AiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    entry = AiAnalysis(
        period_start=start,
        period_end=end,
        question=question,
        text=text,
        provider=config.provider,
        model=config.model,
        created_by=me.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/ai-analyses", response_model=list[AiAnalysisOut])
def list_ai_analyses(
    db: Session = Depends(get_db),
    _: User = Depends(owner),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[AiAnalysis]:
    stmt = select(AiAnalysis).order_by(AiAnalysis.id.desc()).limit(limit)
    return list(db.scalars(stmt))


@router.delete("/ai-analyses/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ai_analysis(
    analysis_id: int, db: Session = Depends(get_db), me: User = Depends(owner)
) -> None:
    entry = db.get(AiAnalysis, analysis_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analisis tidak ditemukan")
    log_activity(
        db,
        me,
        "report.ai_delete",
        f"Menghapus analisis AI {entry.period_start:%d/%m/%Y}–{entry.period_end:%d/%m/%Y}",
        entity_id=analysis_id,
    )
    db.delete(entry)
    db.commit()
