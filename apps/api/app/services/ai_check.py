"""Cek kesesuaian angka di jawaban AI dengan data laporan yang dikirim ke AI.

Setiap angka di jawaban (Rp150.000, 12,5 kg, 80%, Rp1,2 juta) dicocokkan dengan angka di data
JSON. Angka dianggap sesuai bila ada nilai data yang sama setelah dibulatkan ke ketelitian yang
ditulis AI, mis. "Rp1,2 juta" sesuai dengan 1.234.000. Angka yang tidak ditemukan bisa berarti
AI mengarang atau menghitung sendiri, dan perlu diperiksa manusia.

Tanggal, jam, dan nomor urut daftar tidak ikut dicek.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field

MONTHS = (
    "januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember"
    "|jan|feb|mar|apr|jun|jul|agu|agt|sep|okt|nov|des"
)
_SKIP = [
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),  # 2026-11-02
    re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b"),  # 02/11/2026, 2/11
    re.compile(rf"\b\d{{1,2}}(?:\s*[–-]\s*\d{{1,2}})?\s+(?:{MONTHS})\b(?:\s+\d{{4}})?", re.I),
    re.compile(r"\b\d{1,2}:\d{2}\b"),  # 08:00
    re.compile(r"(?:jam|pukul)\s+\d{1,2}(?:\.\d{2})?(?:\s*[–-]\s*\d{1,2}(?:\.\d{2})?)?", re.I),
    re.compile(r"\b\d{1,2}\.\d{2}\s*WIB\b"),
    re.compile(r"^\s*\d+[.)]\s", re.M),  # nomor urut daftar
    re.compile(r"^#+.*$", re.M),  # judul bagian
]
_NUMBER = re.compile(
    r"(?P<rp>Rp\.?\s?)?"
    r"(?P<num>\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)"
    r"(?:\s?(?P<unit>juta|jt|ribu|rb|%|persen))?",
    re.I,
)
SCALE = {"juta": 1_000_000, "jt": 1_000_000, "ribu": 1_000, "rb": 1_000}


@dataclass(frozen=True)
class Claim:
    text: str
    value: float
    # Selisih terbesar yang masih dianggap pembulatan dari angka yang ditulis.
    tolerance: float


@dataclass
class FactCheck:
    matched: list[Claim] = field(default_factory=list)
    unmatched: list[Claim] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.matched) + len(self.unmatched)

    @property
    def accuracy_pct(self) -> float | None:
        return round(100 * len(self.matched) / self.total, 1) if self.total else None


def _parse(num: str) -> tuple[float, int]:
    """Angka format Indonesia (titik ribuan, koma desimal) atau Inggris (titik desimal)."""
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", num):
        whole, _, frac = num.partition(",")
        num = whole.replace(".", "") + (f".{frac}" if frac else "")
    else:
        num = num.replace(",", ".")
    decimals = len(num.split(".")[1]) if "." in num else 0
    return float(num), decimals


def extract_claims(text: str) -> list[Claim]:
    for pattern in _SKIP:
        text = pattern.sub(" ", text)
    claims = []
    for m in _NUMBER.finditer(text):
        value, decimals = _parse(m["num"])
        unit = (m["unit"] or "").lower()
        scale = SCALE.get(unit, 1)
        claims.append(
            Claim(
                text=m.group(0).strip(),
                value=value * scale,
                tolerance=0.5 * 10**-decimals * scale,
            )
        )
    return claims


def data_numbers(data: object) -> set[float]:
    """Semua nilai angka di data JSON.

    Teks (tanggal, jam, nama) tidak diambil: tanggal dan jam di jawaban juga tidak dicek, dan
    angka kecil dari tanggal akan membuat angka karangan ikut dianggap sesuai.
    """
    found: set[float] = set()

    def walk(value: object) -> None:
        if isinstance(value, bool) or value is None or isinstance(value, str):
            return
        if isinstance(value, int | float):
            found.add(float(value))
        elif isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, Iterable):
            for v in value:
                walk(v)

    walk(data)
    return found


def check_answer(text: str, data: object) -> FactCheck:
    numbers = data_numbers(data)
    result = FactCheck()
    for claim in extract_claims(text):
        ok = any(abs(n - claim.value) <= claim.tolerance + 1e-9 for n in numbers)
        (result.matched if ok else result.unmatched).append(claim)
    return result


# Balasan wajib AI bila permintaan di luar analisis laporan (lihat AI_SYSTEM_PROMPT).
OFF_TOPIC_MARKER = "DI_LUAR_TOPIK"
OFF_TOPIC_MESSAGE = (
    "Pertanyaan ini di luar laporan. Coba tanyakan soal penjualan, layanan, atau ketepatan waktu."
)
_CODE = re.compile(
    r"```"
    r"|^\s*(?:def|class|function|import|from\s+\S+\s+import|const|let|var|public\s+class)\b"
    r"|^\s*<(?:!DOCTYPE|html|script|div)\b"
    r"|^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE)\s.+(?:FROM|INTO|SET|TABLE)\b",
    re.I | re.M,
)


def off_topic(text: str) -> bool:
    """Jawaban yang menolak (penanda) atau malah berisi kode program dianggap di luar topik.

    Lapis kedua di server: model tidak selalu patuh pada aturan system prompt.
    """
    return OFF_TOPIC_MARKER in text or bool(_CODE.search(text))
