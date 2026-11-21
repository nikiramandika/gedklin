"""Generate data dummy dengan kolom yang sama persis dengan form pencatatan mitra."""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from gedklin_ml.features import (
    DRYER_PROCESSES,
    EXPRESS_PROCESSES,
    MACHINE_CAPACITY_KG,
    MACHINE_PROCESSES,
    machine_loads,
)

ROOT = Path(__file__).resolve().parents[1]
OPEN, CLOSE = time(8, 0), time(17, 0)
WASHERS, DRYERS, STAFF = 4, 3, 2
# Mitra tutup setiap hari Minggu (weekday 6).
CLOSED_WEEKDAYS = {6}
# Pengerjaan dimulai sekian JAM KERJA (jam buka) sebelum batas janji, acak dalam rentang ini.
# Dihitung dalam jam kerja supaya selalu tersisa waktu buka untuk mengerjakannya.
LEAD_BUFFER_HOURS = (5.0, 11.0)
HOURLY_WEIGHT = {8: 3, 9: 4, 10: 3, 11: 2, 12: 1.5, 13: 1.5, 14: 1.5, 15: 2, 16: 3}
LAYANAN_P = {"C": 0.05, "CK": 0.12, "CKL": 0.38, "CKS": 0.35, "S": 0.05, "SATUAN": 0.05}
# Asumsi untuk dummy: janji mitra untuk C, CK, S, dan SATUAN belum diketahui.
SIM_PROMISE_HOURS = {"C": 24, "CK": 36, "CKL": 48, "CKS": 96, "S": 48, "SATUAN": 48}
EXPRESS_PROMISE_HOURS = 24

WASH_MIN, DRY_MIN = 50, 60
FOLD_MIN_PER_LOAD, IRON_MIN_PER_KG, PACK_MIN = 12, 12, 5
KHUSUS_MIN_PER_PCS, SATUAN_MIN_PER_PCS, DRY_CLEAN_MIN_PER_PCS = 10, 15, 20


def daily_schedule(rng: np.random.Generator, start: date, days: int) -> pd.DataFrame:
    rows = []
    for i in range(days):
        d = start + timedelta(days=i)
        rows.append(
            {
                "date": d.isoformat(),
                "staff_on_duty": STAFF - int(rng.random() < 0.08),
                "washers_available": WASHERS - int(rng.choice([0, 1, 2], p=[0.85, 0.11, 0.04])),
                "dryers_available": DRYERS - int(rng.random() < 0.12),
                "open_time": OPEN.strftime("%H:%M"),
                "close_time": CLOSE.strftime("%H:%M"),
                "is_open": int(d.weekday() not in CLOSED_WEEKDAYS),
            }
        )
    return pd.DataFrame(rows)


def arrivals(rng: np.random.Generator, daily: pd.DataFrame) -> list[dict]:
    hours = list(HOURLY_WEIGHT)
    p = np.array([HOURLY_WEIGHT[h] for h in hours], dtype=float)
    layanan_codes = list(LAYANAN_P)
    orders = []
    for row in daily.itertuples(index=False):
        d = date.fromisoformat(row.date)
        if not row.is_open:
            continue
        n = int(rng.poisson(22 if d.weekday() >= 5 else 16))
        for h in rng.choice(hours, size=n, p=p / p.sum()):
            layanan = str(rng.choice(layanan_codes, p=list(LAYANAN_P.values())))
            berat = (
                0.0
                if layanan == "SATUAN"
                else round(float(np.clip(rng.gamma(3.0, 1.8), 1.0, 20.0)), 1)
            )
            pcs_khusus = (
                int(rng.integers(1, 4)) if layanan in DRYER_PROCESSES and rng.random() < 0.15 else 0
            )
            if layanan == "SATUAN":
                pcs_satuan = int(rng.integers(1, 6))
            else:
                pcs_satuan = int(rng.integers(1, 4)) if rng.random() < 0.08 else 0
            pcs_dry_clean = int(rng.integers(1, 3)) if rng.random() < 0.03 else 0
            express = layanan in EXPRESS_PROCESSES and rng.random() < 0.2
            orders.append(
                {
                    "received_at": datetime.combine(d, time(int(h), int(rng.integers(0, 60)))),
                    "layanan_utama": layanan,
                    "express": express,
                    "berat_kg": berat,
                    "pcs_khusus": pcs_khusus,
                    "pcs_satuan": pcs_satuan,
                    "pcs_dry_clean": pcs_dry_clean,
                    "ada_setrika": layanan in ("CKS", "S") or pcs_satuan > 0,
                }
            )
    orders.sort(key=lambda o: o["received_at"])
    for i, o in enumerate(orders, start=1):
        o["order_id"] = f"GK-{i:05d}"
    return orders


@dataclass
class Job:
    order: dict
    priority: tuple
    eligible_at: datetime
    to_wash: int
    needs_dryer: bool
    staff_min: float
    washed: int = 0
    machine_done: int = 0
    loads: int = 0
    staff_busy: bool = field(default=False)

    @property
    def machines_finished(self) -> bool:
        return self.machine_done >= self.loads


def _promise_deadline(received: datetime, hours: float) -> datetime:
    end = received + timedelta(hours=hours)
    day = received.date() + timedelta(days=1)
    while day <= end.date():
        if day.weekday() in CLOSED_WEEKDAYS:
            end += timedelta(days=1)
        day += timedelta(days=1)
    return end


def _minus_open_hours(dt: datetime, hours: float) -> datetime:
    """Mundur sekian jam buka dari dt (jam tutup dan hari tutup dilewati)."""
    remaining = timedelta(hours=hours)
    cursor = dt
    while remaining > timedelta(0):
        day = cursor.date()
        open_dt, close_dt = datetime.combine(day, OPEN), datetime.combine(day, CLOSE)
        if day.weekday() in CLOSED_WEEKDAYS or cursor <= open_dt:
            cursor = datetime.combine(day - timedelta(days=1), CLOSE)
            continue
        cursor = min(cursor, close_dt)
        step = min(remaining, cursor - open_dt)
        cursor -= step
        remaining -= step
    return cursor


def make_job(rng: np.random.Generator, o: dict) -> Job:
    layanan, kg = o["layanan_utama"], o["berat_kg"]
    loads = machine_loads(kg, MACHINE_CAPACITY_KG) if layanan in MACHINE_PROCESSES else 0
    loads += math.ceil(o["pcs_khusus"] / 2)
    staff = (
        PACK_MIN
        + KHUSUS_MIN_PER_PCS * o["pcs_khusus"]
        + SATUAN_MIN_PER_PCS * o["pcs_satuan"]
        + DRY_CLEAN_MIN_PER_PCS * o["pcs_dry_clean"]
    )
    if layanan == "CKL":
        staff += FOLD_MIN_PER_LOAD * loads
    if layanan in ("CKS", "S"):
        staff += IRON_MIN_PER_KG * kg
    promise = EXPRESS_PROMISE_HOURS if o["express"] else SIM_PROMISE_HOURS[layanan]
    # Petugas mengatur kerja dari batas janji; hari tutup tidak dihitung dalam janji.
    deadline = _promise_deadline(o["received_at"], promise)
    buffer = float(rng.uniform(*LEAD_BUFFER_HOURS))
    eligible_at = max(o["received_at"], _minus_open_hours(deadline, buffer))
    return Job(
        order=o,
        priority=(0 if o["express"] else 1, o["received_at"], o["order_id"]),
        eligible_at=eligible_at,
        to_wash=loads,
        loads=loads,
        needs_dryer=layanan in DRYER_PROCESSES or o["pcs_khusus"] > 0,
        staff_min=staff * float(rng.lognormal(0, 0.15)),
    )


def simulate(rng: np.random.Generator, orders: list[dict], daily: pd.DataFrame) -> None:
    pending = [make_job(rng, o) for o in orders]
    active: list[Job] = []
    # Waktu mesin dihitung dalam menit jam buka; mesin berhenti saat toko tutup.
    washers: list[tuple[int, Job] | None] = [None] * WASHERS
    dryers: list[tuple[int, Job] | None] = [None] * DRYERS
    tick = 0

    for row in daily.itertuples(index=False):
        if not row.is_open:
            continue
        d = date.fromisoformat(row.date)
        t = datetime.combine(d, time.fromisoformat(row.open_time))
        close_dt = datetime.combine(d, time.fromisoformat(row.close_time))
        while t < close_dt:
            while pending and pending[0].order["received_at"] <= t:
                active.append(pending.pop(0))
                active.sort(key=lambda j: j.priority)

            for machines, is_dryer in ((washers, False), (dryers, True)):
                for i, slot in enumerate(machines):
                    if slot is not None and slot[0] <= tick:
                        job = slot[1]
                        if is_dryer or not job.needs_dryer:
                            job.machine_done += 1
                        else:
                            job.washed += 1
                        machines[i] = None

            eligible = [j for j in active if j.eligible_at <= t]
            for i in range(row.washers_available):
                job = next((j for j in eligible if j.to_wash > 0), None)
                if washers[i] is None and job is not None:
                    job.to_wash -= 1
                    washers[i] = (tick + WASH_MIN, job)
            for i in range(row.dryers_available):
                job = next((j for j in eligible if j.washed > 0), None)
                if dryers[i] is None and job is not None:
                    job.washed -= 1
                    dryers[i] = (tick + DRY_MIN, job)

            for _ in range(row.staff_on_duty):
                job = next((j for j in eligible if j.machines_finished and not j.staff_busy), None)
                if job is None:
                    break
                job.staff_busy = True
                job.staff_min -= 1
                if job.staff_min <= 0:
                    job.order["ready_at"] = t + timedelta(minutes=1)
                    active.remove(job)
            for j in active:
                j.staff_busy = False

            t += timedelta(minutes=1)
            tick += 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--start", default="2026-10-14")
    parser.add_argument("--days", type=int, default=25)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "data" / "raw")
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    # Simulasi diperpanjang 10 hari supaya pesanan di hari terakhir sempat selesai.
    daily_all = daily_schedule(rng, date.fromisoformat(args.start), args.days + 10)
    daily = daily_all.iloc[: args.days]
    orders = arrivals(rng, daily)
    simulate(rng, orders, daily_all)

    df = pd.DataFrame([o for o in orders if "ready_at" in o])
    df = df[
        [
            "order_id",
            "received_at",
            "ready_at",
            "layanan_utama",
            "express",
            "berat_kg",
            "pcs_khusus",
            "pcs_satuan",
            "pcs_dry_clean",
            "ada_setrika",
        ]
    ]
    for col in ("received_at", "ready_at"):
        df[col] = df[col].dt.strftime("%Y-%m-%d %H:%M")
    df["express"] = df["express"].astype(int)
    df["ada_setrika"] = df["ada_setrika"].astype(int)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out_dir / "orders_dummy.csv", index=False)
    last_ready = pd.to_datetime(df["ready_at"]).max().date().isoformat()
    daily_out = daily_all[daily_all["date"] <= max(last_ready, daily["date"].iloc[-1])]
    daily_out.to_csv(args.out_dir / "daily_dummy.csv", index=False)
    print(
        f"[DUMMY] {len(df)} pesanan, {len(daily)} hari ({int(daily['is_open'].sum())} buka)"
        f" -> {args.out_dir}"
    )


if __name__ == "__main__":
    main()
