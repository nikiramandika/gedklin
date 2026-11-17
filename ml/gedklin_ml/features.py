"""Feature builder bersama untuk training (ml/scripts) dan inferensi (apps/api).

Semua fitur dihitung pada saat pesanan masuk (`received_at`) dan tidak boleh
memakai informasi masa depan. Jangan duplikasi logika ini di tempat lain.

Isi pesanan bisa datang dari dua sumber dengan bentuk berbeda:
- form pencatatan mitra (satu baris per pesanan) -> `content_from_form`
- item pesanan di aplikasi (`order_items`) -> `content_from_items`
Keduanya dirangkum menjadi `OrderContent` supaya fitur yang dihasilkan sama.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING, Protocol
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    import pandas as pd

LOCAL_TZ = ZoneInfo("Asia/Jakarta")

# --- Proses layanan --------------------------------------------------------

PROCESSES = ("C", "CK", "CKL", "CKS", "S", "SATUAN", "DRY_CLEAN")
PROCESS_LEVEL: dict[str, int] = {"C": 1, "CK": 2, "CKL": 3, "CKS": 4}
MACHINE_PROCESSES = frozenset({"C", "CK", "CKL", "CKS"})
DRYER_PROCESSES = frozenset({"CK", "CKL", "CKS"})
# Setrika dan item satuan dikerjakan manual oleh 2 petugas yang sama, tanpa mesin,
# sehingga kemungkinan besar jadi penyebab antrean.
IRONING_PROCESSES = frozenset({"CKS", "S", "SATUAN"})
# Express hanya untuk kiloan CKL dan CKS (di API dibaca dari flag express_eligible katalog).
EXPRESS_PROCESSES = frozenset({"CKL", "CKS"})

# Kelompok katalog (lihat apps/api/seed/price_catalog.json).
GROUP_KILOAN = "KILOAN"
GROUP_SETRIKA = "SETRIKA"
GROUP_KHUSUS = "KHUSUS"
GROUP_SATUAN = "SATUAN"
GROUP_DRY_CLEAN = "DRY_CLEAN"

# Kapasitas satu mesin cuci. Hanya untuk menghitung load operasional (fitur ML),
# terpisah dari harga. Di API nilainya dari pengaturan machine_capacity_kg.
MACHINE_CAPACITY_KG = 8.0
# Janji bila semua layanan di pesanan belum punya janji standar (sementara).
DEFAULT_PROMISE_HOURS = 48.0


def count_loads(qty: float, per_load: float, max_extra: float = 0.0) -> int:
    """`max(1, ceil((qty - max_extra) / per_load))`, untuk item khusus per load.

    Contoh selimut besar (2 pcs/load + maks 1 pcs tambahan): 3 pcs = 1, 4 pcs = 2.
    """
    # Dibulatkan dulu supaya galat float (mis. 14.000000001) tidak menambah load.
    return max(1, math.ceil(round((qty - max_extra) / per_load, 9)))


def machine_loads(weight_kg: float, capacity_kg: float = MACHINE_CAPACITY_KG) -> int:
    """Load mesin kiloan: `ceil(kg / kapasitas)`. Contoh 8 kg = 1, 12 kg = 2."""
    if weight_kg <= 0:
        return 0
    return max(1, math.ceil(round(weight_kg / capacity_kg, 9)))


# --- Fitur -----------------------------------------------------------------

FEATURE_ORDER: list[str] = [
    # Isi pesanan
    "is_express",
    "total_machine_loads",
    "total_weight_kg",
    "max_process_level",
    "has_ironing",
    "ironing_kg",
    "n_special_items",
    "n_satuan_items",
    "n_dry_clean_items",
    # Waktu
    "hour_of_day",
    "day_of_week",
    "minutes_to_close",
    # Antrean
    "active_orders_count",
    "active_express_count",
    "active_loads_total",
    "active_ironing_kg",
    "active_satuan_items",
    # Janji
    "promised_hours",
    # Operasional
    "staff_on_duty",
    "washers_available",
    "dryers_available",
    # Rasio beban
    "loads_per_washer",
    "dry_loads_per_dryer",
]
# Durasi jam kalender ready_at - received_at (yang dilihat pelanggan). Error model
# selalu dilaporkan dalam satuan ini.
TARGET = "duration_hours"
# Target yang dipelajari model: durasi dalam jam operasional hari buka. Cucian tidak
# dikerjakan saat toko tutup, jadi prediksi jam kerja dikonversi kembali ke waktu
# kalender dengan `add_work_hours` dan otomatis jatuh di jam buka, tersebar sepanjang
# hari (bukan menumpuk di jam buka seperti saat jam kalender dipotong ke jam buka).
WORK_TARGET = "duration_work_hours"
MODEL_UNIT = "work_hours"


@dataclass(frozen=True)
class DayOps:
    """Kondisi operasional satu hari. Default = kapasitas normal mitra."""

    is_open: bool = True
    staff_on_duty: int = 2
    washers_available: int = 4
    dryers_available: int = 3
    open_time: time = time(8, 0)
    close_time: time = time(17, 0)


DEFAULT_DAY_OPS = DayOps()
DayOpsLookup = Callable[[date], DayOps]


@dataclass(frozen=True)
class OrderContent:
    is_express: bool
    total_machine_loads: int
    total_weight_kg: float
    max_process_level: int
    has_ironing: bool
    ironing_kg: float
    n_special_items: int
    n_satuan_items: int
    n_dry_clean_items: int
    # Load yang butuh mesin pengering (CK, CKL, CKS).
    dry_loads: int
    # Proses yang ada di pesanan, untuk menentukan janji waktu. Proses item yang
    # dikerjakan Express (hanya CKL/CKS) dipisah karena janjinya berbeda.
    processes: tuple[str, ...]
    express_processes: tuple[str, ...] = ()


class ItemLike(Protocol):
    group: str
    process: str
    weight_kg: float | None
    qty_pcs: int | None
    machine_loads: int | None
    is_express: bool


def content_from_items(items: Iterable[ItemLike], is_express: bool) -> OrderContent:
    """Ringkas item pesanan aplikasi menjadi bentuk yang setara dengan form pencatatan."""
    total_loads = dry_loads = n_special = n_satuan = n_dry_clean = 0
    weight = ironing_kg = 0.0
    level = 0
    has_ironing = False
    processes: list[str] = []
    express_processes: list[str] = []
    for item in items:
        group, process = str(item.group), str(item.process)
        kg = float(item.weight_kg or 0)
        (express_processes if item.is_express else processes).append(process)
        level = max(level, PROCESS_LEVEL.get(process, 0))
        if process in IRONING_PROCESSES:
            has_ironing = True
        if group in (GROUP_KILOAN, GROUP_SETRIKA):
            weight += kg
            if process in IRONING_PROCESSES:
                ironing_kg += kg
        # Hanya kiloan yang dihitung load mesinnya, supaya setara dengan form
        # pencatatan (berat_kg milik layanan_utama). Satuan dan dry clean tanpa mesin.
        if group == GROUP_KILOAN:
            loads = int(item.machine_loads or 0)
            total_loads += loads
            if process in DRYER_PROCESSES:
                dry_loads += loads
        elif group == GROUP_KHUSUS:
            n_special += int(item.qty_pcs or 1)
        elif group == GROUP_SATUAN:
            n_satuan += int(item.qty_pcs or 0)
        elif group == GROUP_DRY_CLEAN:
            n_dry_clean += int(item.qty_pcs or 0)
    return OrderContent(
        is_express=bool(is_express),
        total_machine_loads=total_loads,
        total_weight_kg=round(weight, 2),
        max_process_level=level,
        has_ironing=has_ironing,
        ironing_kg=round(ironing_kg, 2),
        n_special_items=n_special,
        n_satuan_items=n_satuan,
        n_dry_clean_items=n_dry_clean,
        dry_loads=dry_loads,
        processes=tuple(dict.fromkeys(processes)),
        express_processes=tuple(dict.fromkeys(express_processes)),
    )


def content_from_form(
    *,
    layanan_utama: str,
    express: bool,
    berat_kg: float,
    pcs_khusus: int,
    pcs_satuan: int,
    pcs_dry_clean: int,
    ada_setrika: bool,
    machine_capacity_kg: float = MACHINE_CAPACITY_KG,
) -> OrderContent:
    """Ringkas satu baris form pencatatan mitra.

    Express hanya berlaku untuk CKL/CKS; tanda Express pada layanan lain diabaikan.
    """
    layanan = str(layanan_utama).strip().upper()
    if layanan not in PROCESSES:
        raise ValueError(f"layanan_utama tidak dikenal: {layanan_utama}")
    kg = float(berat_kg or 0)
    is_express = bool(express) and layanan in EXPRESS_PROCESSES
    loads = machine_loads(kg, machine_capacity_kg) if layanan in MACHINE_PROCESSES else 0
    n_satuan = int(pcs_satuan or 0)
    return OrderContent(
        is_express=is_express,
        total_machine_loads=loads,
        total_weight_kg=round(kg, 2),
        max_process_level=PROCESS_LEVEL.get(layanan, 0),
        has_ironing=bool(ada_setrika) or layanan in IRONING_PROCESSES or n_satuan > 0,
        ironing_kg=round(kg, 2) if layanan in IRONING_PROCESSES else 0.0,
        n_special_items=int(pcs_khusus or 0),
        n_satuan_items=n_satuan,
        n_dry_clean_items=int(pcs_dry_clean or 0),
        dry_loads=loads if layanan in DRYER_PROCESSES else 0,
        processes=() if is_express else (layanan,),
        express_processes=(layanan,) if is_express else (),
    )


# --- Waktu -----------------------------------------------------------------


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_local(dt: datetime) -> datetime:
    return _as_utc(dt).astimezone(LOCAL_TZ)


def local_date(dt: datetime) -> date:
    return to_local(dt).date()


def _open_window(day: date, ops: DayOps) -> tuple[datetime, datetime]:
    return (
        datetime.combine(day, ops.open_time, tzinfo=LOCAL_TZ),
        datetime.combine(day, ops.close_time, tzinfo=LOCAL_TZ),
    )


def minutes_to_close(received_at: datetime, day: DayOps) -> float:
    if not day.is_open:
        return 0.0
    local = to_local(received_at)
    _, close_dt = _open_window(local.date(), day)
    return max(0.0, (close_dt - local) / timedelta(minutes=1))


def shift_into_open_hours(dt: datetime, day_ops: DayOpsLookup, max_days: int = 14) -> datetime:
    """Geser waktu yang jatuh di luar jam buka ke jam buka berikutnya (hari tutup dilewati)."""
    local = to_local(dt)
    for _ in range(max_days):
        ops = day_ops(local.date())
        if ops.is_open:
            open_dt, close_dt = _open_window(local.date(), ops)
            if local < open_dt:
                return open_dt.astimezone(UTC)
            if local <= close_dt:
                return local.astimezone(UTC)
        local = datetime.combine(local.date() + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
    return _as_utc(dt)


def work_hours_between(start: datetime, end: datetime, day_ops: DayOpsLookup) -> float:
    """Durasi yang hanya dihitung dalam jam operasional pada hari buka."""
    start_l, end_l = to_local(start), to_local(end)
    if end_l <= start_l:
        return 0.0
    total = timedelta()
    day = start_l.date()
    while day <= end_l.date():
        ops = day_ops(day)
        if ops.is_open:
            open_dt, close_dt = _open_window(day, ops)
            lo, hi = max(open_dt, start_l), min(close_dt, end_l)
            if hi > lo:
                total += hi - lo
        day += timedelta(days=1)
    return total / timedelta(hours=1)


def add_work_hours(
    start: datetime, hours: float, day_ops: DayOpsLookup, max_days: int = 60
) -> datetime:
    """Kebalikan `work_hours_between`: maju `hours` jam operasional dari `start`.

    Jam tutup dan hari libur dilewati, jadi hasilnya selalu jatuh di dalam jam buka.
    Contoh buka 08-17: Senin 16.00 + 3 jam kerja = Selasa 10.00.
    """
    local = to_local(start)
    remaining = timedelta(hours=max(float(hours), 0.0))
    for _ in range(max_days):
        ops = day_ops(local.date())
        if ops.is_open:
            open_dt, close_dt = _open_window(local.date(), ops)
            cursor = max(local, open_dt)
            if cursor <= close_dt:
                if cursor + remaining <= close_dt:
                    return (cursor + remaining).astimezone(UTC)
                remaining -= close_dt - cursor
        local = datetime.combine(local.date() + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
    return (local + remaining).astimezone(UTC)


# --- Janji waktu -----------------------------------------------------------


@dataclass(frozen=True)
class Promise:
    """Janji waktu standar mitra per proses (jam kalender). None = belum diketahui."""

    regular_hours: float | None
    express_hours: float | None


def promised_hours(
    content: OrderContent,
    promises: Mapping[str, Promise],
    default_hours: float,
) -> float:
    """Janji pesanan = janji terlama di antara item di pesanan.

    Item Express (CKL/CKS) memakai janji Express, item lain janji Reguler, jadi
    pesanan Express yang juga berisi bed cover tetap menunggu janji bed cover.
    """
    known = []
    for processes, express in ((content.processes, False), (content.express_processes, True)):
        for process in processes:
            promise = promises.get(process)
            if promise is None:
                continue
            hours = promise.express_hours if express else promise.regular_hours
            if hours is not None:
                known.append(float(hours))
    return max(known) if known else float(default_hours)


# --- Antrean ---------------------------------------------------------------


@dataclass(frozen=True)
class QueueRecord:
    """Satu pesanan lain, cukup untuk menghitung kondisi antrean."""

    received_at: datetime
    ready_at: datetime | None
    is_express: bool
    loads: int
    dry_loads: int
    ironing_kg: float
    satuan_items: int = 0

    @classmethod
    def from_content(
        cls, received_at: datetime, ready_at: datetime | None, content: OrderContent
    ) -> QueueRecord:
        return cls(
            received_at=received_at,
            ready_at=ready_at,
            is_express=content.is_express,
            loads=content.total_machine_loads,
            dry_loads=content.dry_loads,
            ironing_kg=content.ironing_kg,
            satuan_items=content.n_satuan_items,
        )


@dataclass(frozen=True)
class QueueStats:
    count: int = 0
    express_count: int = 0
    loads: int = 0
    dry_loads: int = 0
    ironing_kg: float = 0.0
    satuan_items: int = 0

    def max(self, other: QueueStats) -> QueueStats:
        return QueueStats(
            count=max(self.count, other.count),
            express_count=max(self.express_count, other.express_count),
            loads=max(self.loads, other.loads),
            dry_loads=max(self.dry_loads, other.dry_loads),
            ironing_kg=max(self.ironing_kg, other.ironing_kg),
            satuan_items=max(self.satuan_items, other.satuan_items),
        )


def summarize_queue(records: Iterable[QueueRecord]) -> QueueStats:
    count = express = loads = dry = satuan = 0
    ironing = 0.0
    for r in records:
        count += 1
        express += int(r.is_express)
        loads += r.loads
        dry += r.dry_loads
        ironing += r.ironing_kg
        satuan += r.satuan_items
    return QueueStats(count, express, loads, dry, round(ironing, 2), satuan)


def queue_stats(at: datetime, records: Iterable[QueueRecord]) -> QueueStats:
    """Pesanan aktif pada waktu `at`: sudah masuk sebelum `at` dan belum READY."""
    at = _as_utc(at)
    return summarize_queue(
        r
        for r in records
        if _as_utc(r.received_at) < at and (r.ready_at is None or _as_utc(r.ready_at) > at)
    )


# --- Builder ---------------------------------------------------------------


def build_features(
    *,
    received_at: datetime,
    content: OrderContent,
    queue: QueueStats,
    day: DayOps,
    promised_hours: float,
) -> dict[str, float]:
    local = to_local(received_at)
    return {
        "is_express": 1.0 if content.is_express else 0.0,
        "total_machine_loads": float(content.total_machine_loads),
        "total_weight_kg": float(content.total_weight_kg),
        "max_process_level": float(content.max_process_level),
        "has_ironing": 1.0 if content.has_ironing else 0.0,
        "ironing_kg": float(content.ironing_kg),
        "n_special_items": float(content.n_special_items),
        "n_satuan_items": float(content.n_satuan_items),
        "n_dry_clean_items": float(content.n_dry_clean_items),
        "hour_of_day": float(local.hour),
        "day_of_week": float(local.weekday()),
        "minutes_to_close": minutes_to_close(received_at, day),
        "active_orders_count": float(queue.count),
        "active_express_count": float(queue.express_count),
        "active_loads_total": float(queue.loads),
        "active_ironing_kg": float(queue.ironing_kg),
        "active_satuan_items": float(queue.satuan_items),
        "promised_hours": float(promised_hours),
        "staff_on_duty": float(day.staff_on_duty),
        "washers_available": float(day.washers_available),
        "dryers_available": float(day.dryers_available),
        # Mesin rusak semua (0) tetap terbaca lewat fitur washers/dryers_available.
        "loads_per_washer": queue.loads / max(day.washers_available, 1),
        "dry_loads_per_dryer": queue.dry_loads / max(day.dryers_available, 1),
    }


def to_vector(features: dict[str, float]) -> list[float]:
    return [features[name] for name in FEATURE_ORDER]


def daily_lookup(daily: pd.DataFrame) -> DayOpsLookup:
    """Buat lookup DayOps dari tabel harian (kolom seperti `data.load_daily`)."""
    table = {
        row.date: DayOps(
            is_open=bool(getattr(row, "is_open", True)),
            staff_on_duty=int(row.staff_on_duty),
            washers_available=int(row.washers_available),
            dryers_available=int(row.dryers_available),
            open_time=row.open_time,
            close_time=row.close_time,
        )
        for row in daily.itertuples(index=False)
    }
    return lambda d: table.get(d, DEFAULT_DAY_OPS)


def build_feature_frame(
    orders: pd.DataFrame,
    daily: pd.DataFrame,
    promises: Mapping[str, Promise],
    default_promise_hours: float,
    machine_capacity_kg: float = MACHINE_CAPACITY_KG,
) -> pd.DataFrame:
    """Bangun tabel fitur + target dari data mentah (bentuk `data.load_orders`)."""
    import pandas as pd

    day_ops = daily_lookup(daily)
    contents = [
        content_from_form(
            layanan_utama=r.layanan_utama,
            express=bool(r.express),
            berat_kg=r.berat_kg,
            pcs_khusus=r.pcs_khusus,
            pcs_satuan=r.pcs_satuan,
            pcs_dry_clean=r.pcs_dry_clean,
            ada_setrika=bool(r.ada_setrika),
            machine_capacity_kg=machine_capacity_kg,
        )
        for r in orders.itertuples(index=False)
    ]
    records = [
        QueueRecord.from_content(r.received_at.to_pydatetime(), r.ready_at.to_pydatetime(), c)
        for r, c in zip(orders.itertuples(index=False), contents, strict=True)
    ]

    rows: list[dict[str, object]] = []
    for r, content in zip(orders.itertuples(index=False), contents, strict=True):
        received = r.received_at.to_pydatetime()
        ready = r.ready_at.to_pydatetime()
        feats = build_features(
            received_at=received,
            content=content,
            queue=queue_stats(received, records),
            day=day_ops(local_date(received)),
            promised_hours=promised_hours(content, promises, default_promise_hours),
        )
        rows.append(
            {
                "order_id": r.order_id,
                "received_at": r.received_at,
                "layanan_utama": r.layanan_utama,
                **feats,
                TARGET: (ready - received) / timedelta(hours=1),
                WORK_TARGET: work_hours_between(received, ready, day_ops),
            }
        )
    return pd.DataFrame(rows)
