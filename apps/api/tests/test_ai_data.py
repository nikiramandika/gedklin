"""Pengujian kebenaran data analisis AI.

1. Data yang dikirim ke AI harus sama dengan hitungan manual dari pesanan uji.
2. Prompt yang benar-benar terkirim ke penyedia AI memuat data itu apa adanya.
3. Angka di jawaban AI dicek terhadap data: yang sesuai lolos, yang dikarang tertandai.
"""

import json
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order, OrderStatus, PaymentMethod, ServiceCatalog
from app.routers.reports import ai_context
from app.services import ai
from app.services.ai_check import check_answer, extract_claims
from app.services.orders import cancel_order, change_status, create_order
from app.services.pricing import ItemRequest

START, END = date(2026, 11, 2), date(2026, 11, 8)  # Senin s.d. Minggu


def wib(day: int, hour: int) -> datetime:
    return datetime(2026, 11, day, hour, 0, tzinfo=UTC) - timedelta(hours=7)


def _order(
    db: Session,
    phone: str,
    at: datetime,
    item: ItemRequest,
    *,
    express: bool = False,
    paid: PaymentMethod | None = None,
) -> Order:
    return create_order(
        db,
        customer_name="Pelanggan Uji",
        customer_phone=phone,
        is_express=express,
        items=[item],
        user=None,
        payment_method=paid,
        now=at,
    )


def _ready(db: Session, order: Order, at: datetime) -> None:
    change_status(db, order, OrderStatus.PROCESSING, None, at - timedelta(hours=1))
    change_status(db, order, OrderStatus.READY, None, at)


@pytest.fixture
def dataset(db: Session) -> None:
    """Pesanan uji dengan hasil yang bisa dihitung tangan.

    | # | Diterima          | Isi             | Total   | Bayar | Janji         | Siap          |
    | 1 | Sen 02/11 10.00   | CKL 5 kg        | 25.000  | Tunai | Rab 04/11 10  | Rab 09.00     |
    | 2 | Sen 02/11 11.00   | CKL 9 kg        | 39.000  | -     | Rab 04/11 11  | -             |
    | 3 | Sel 03/11 09.00   | CKS 8 kg Express| 110.000 | QRIS  | Rab 04/11 09  | Rab 11.00 (+2)|
    | 4 | Rab 04/11 14.00   | CKL 5 kg        | batal   | -     |               |               |

    Janji dikunci di sini (CKL 48 jam, Express CKS 24 jam) supaya tabel tidak ikut berubah bila
    janji di katalog diubah.
    """
    catalog = {c.code: c for c in db.scalars(select(ServiceCatalog))}
    catalog["CKL"].promise_hours = 48
    catalog["CKS"].express_promise_hours = 24
    db.commit()
    first = _order(db, "081100000001", wib(2, 10), ItemRequest("CKL", 5), paid=PaymentMethod.CASH)
    _order(db, "081100000002", wib(2, 11), ItemRequest("CKL", 9))
    express = _order(
        db,
        "081100000003",
        wib(3, 9),
        ItemRequest("CKS", 8),
        express=True,
        paid=PaymentMethod.QRIS,
    )
    cancelled = _order(db, "081100000004", wib(4, 14), ItemRequest("CKL", 5))
    _ready(db, first, wib(4, 9))
    _ready(db, express, wib(4, 11))
    cancel_order(db, cancelled, "Pelanggan batal", None, wib(4, 15))


def test_context_totals_match_manual_calculation(db: Session, dataset: None) -> None:
    ctx = ai_context(db, START, END)
    assert ctx["periode"] == {"mulai": "2026-11-02", "akhir": "2026-11-08", "jumlah_hari": 7}
    assert ctx["ringkasan"] == {
        "pesanan": 3,
        "pendapatan": 174_000,
        "rata_rata_per_pesanan": 58_000,
        "berat_kg": 22,
        "pesanan_express": 1,
        "dibatalkan": 1,
        "belum_lunas_rp": 39_000,
        "pesanan_belum_lunas": 1,
    }
    previous = ctx["periode_sebelumnya"]
    assert (previous["mulai"], previous["akhir"]) == ("2026-10-26", "2026-11-01")
    assert previous["pesanan"] == 0 and previous["pendapatan"] == 0


def test_context_breakdowns_match_manual_calculation(db: Session, dataset: None) -> None:
    ctx = ai_context(db, START, END)
    assert [(d["hari"], d["pesanan"], d["pendapatan"]) for d in ctx["per_hari"]] == [
        ("Senin", 2, 64_000),
        ("Selasa", 1, 110_000),
        # Pesanan Rabu dibatalkan, jadi tidak dihitung.
        ("Rabu", 0, 0),
        ("Kamis", 0, 0),
        ("Jumat", 0, 0),
        ("Sabtu", 0, 0),
        ("Minggu", 0, 0),
    ]
    assert ctx["pesanan_masuk_per_jam"] == {"09:00": 1, "10:00": 1, "11:00": 1}
    services = {
        s["nama"]: (s["pesanan"], s["pendapatan"], s["berat_kg"]) for s in ctx["per_layanan"]
    }
    assert services == {
        "Cuci + Kering + Setrika": (1, 110_000, 8),
        "Cuci + Kering + Lipat": (2, 64_000, 14),
    }
    payments = {p["nama"]: (p["pesanan"], p["pendapatan"]) for p in ctx["per_metode_bayar"]}
    assert payments == {"QRIS": (1, 110_000), "Belum lunas": (1, 39_000), "Tunai": (1, 25_000)}
    assert ctx["alasan_batal"] == {"Pelanggan batal": 1}


def test_context_timeliness_matches_manual_calculation(db: Session, dataset: None) -> None:
    # Pesanan 1 siap 1 jam sebelum janji; Express siap 2 jam setelah janji.
    assert ai_context(db, START, END)["ketepatan_waktu"] == {
        "selesai_dengan_janji": 2,
        "terlambat": 1,
        "persen_tepat_waktu": 50.0,
        "rata_rata_terlambat_jam": 2.0,
        "reguler": {"selesai": 1, "terlambat": 0},
        "express": {"selesai": 1, "terlambat": 1},
    }


def test_prompt_sent_to_ai_contains_exact_context(
    client: TestClient, owner: dict, db: Session, dataset: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.put(
        "/settings/ai", json={"provider": "gemini", "api_key": "kunci-uji-123456"}, headers=owner
    )
    sent: dict = {}

    def fake_post(url: str, json: dict, headers: dict, timeout: float) -> httpx.Response:
        sent.update(json)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(ai.httpx, "post", fake_post)
    res = client.post(
        "/reports/ai-analysis", json={"start": "2026-11-02", "end": "2026-11-08"}, headers=owner
    )
    assert res.status_code == 201, res.text
    prompt = sent["messages"][1]["content"]
    payload = json.loads(prompt.split("Data laporan (JSON):\n", 1)[1])
    assert payload == ai_context(db, START, END)
    assert "Pelanggan Uji" not in prompt and "0811" not in prompt


def test_correct_answer_passes_fact_check(db: Session, dataset: None) -> None:
    answer = """## Ringkasan
- Minggu ini ada **3 pesanan** dengan pendapatan **Rp174.000** (rata-rata Rp58.000).
- Total cucian 22 kg; 1 pesanan Express dan 1 dibatalkan.
- Piutang Rp39.000 dari 1 pesanan belum lunas.

## Temuan penting
- Ketepatan waktu 50%: 1 dari 2 pesanan terlambat, rata-rata 2 jam.
- Senin paling ramai (2 pesanan, Rp64.000), pesanan masuk jam 09.00-11.00.
- Layanan CKS menyumbang Rp110 ribu dari 8 kg.

## Saran tindakan
1. Tagih piutang Rp39 ribu saat pelanggan mengambil.
2. Prioritaskan Express agar tidak lewat janji.
"""
    result = check_answer(answer, ai_context(db, START, END))
    assert result.unmatched == []
    assert result.total >= 15 and result.accuracy_pct == 100.0


def test_fabricated_numbers_are_flagged(db: Session, dataset: None) -> None:
    answer = (
        "Pendapatan minggu ini Rp185.000 dari 3 pesanan, naik 25% dari minggu lalu. "
        "Ketepatan waktu 50%."
    )
    result = check_answer(answer, ai_context(db, START, END))
    assert sorted(c.text for c in result.unmatched) == ["25%", "Rp185.000"]
    assert [c.text for c in result.matched] == ["3", "50%"]
    assert result.accuracy_pct == 50.0


@pytest.mark.parametrize(
    ("text", "value"),
    [
        ("Rp150.000", 150_000),
        ("Rp 1.250.000", 1_250_000),
        ("Rp1,2 juta", 1_200_000),
        ("58 ribu", 58_000),
        ("12,5 kg", 12.5),
        ("12.5 kg", 12.5),
        ("80%", 80),
    ],
)
def test_reads_indonesian_number_formats(text: str, value: float) -> None:
    assert [c.value for c in extract_claims(text)] == [value]


def test_rounded_numbers_still_match() -> None:
    data = {"pendapatan": 1_234_000, "persen": 66.7}
    assert check_answer("sekitar Rp1,2 juta, tepat waktu 67%", data).unmatched == []
    assert len(check_answer("sekitar Rp1,3 juta", data).unmatched) == 1


def test_dates_times_and_list_numbers_are_ignored() -> None:
    text = "## 3 Temuan\n1. Periode 2026-11-02 s.d. 08/11/2026, 2 November 2026, pukul 08.00 WIB"
    assert extract_claims(text) == []


def test_test_report_for_paper_lists_flagged_numbers(db: Session, dataset: None) -> None:
    from app.uji_ai import Run, report

    ctx = ai_context(db, START, END)
    good = "Ada 3 pesanan senilai Rp174.000."
    bad = "Ada 3 pesanan senilai Rp185.000."
    runs = [
        Run(1, 2.0, good, check_answer(good, ctx)),
        Run(2, 3.0, bad, check_answer(bad, ctx)),
        Run(3, 60.0, None, None, "Batas pemakaian/kuota AI habis"),
    ]
    text = report(runs, ctx, START, END, "gemini", "gemini-2.5-flash", None)
    assert "| 1 | 2.0 dtk | 2 | 2 | 0 | 100% |" in text
    assert "| 2 | 3.0 dtk | 2 | 1 | 1 | 50% |" in text
    assert "| **Total** | rata-rata 2.5 dtk | 4 | 3 | 1 | **75%** |" in text
    assert "| 2 | Rp185.000 |" in text
    assert "| Pendapatan | Rp174.000 |" in text
    assert "gagal: Batas pemakaian/kuota AI habis" in text
