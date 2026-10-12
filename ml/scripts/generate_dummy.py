"""Generate data dummy dengan kolom yang sama persis dengan form pencatatan mitra.

HANYA untuk menguji pipeline dan aplikasi. Metrik dari data ini tidak boleh
dilaporkan sebagai hasil.

Pola yang disimulasikan (per menit, hanya selama jam buka 08.00-17.00):
- Jam ramai pagi dan sore, akhir pekan lebih ramai.
- 4 mesin cuci dan 3 pengering; sesekali ada mesin rusak atau petugas izin.
- 2 petugas mengerjakan lipat, setrika, dan kemas. Setrika paling lama.
- Petugas mengejar janji mitra: pesanan baru dikerjakan menjelang janjinya
  (Express sekitar 1 hari, CKL sekitar 2 hari, CKS 3-4 hari).
  Urutan antrean: Express dulu, lalu FIFO.
- Antrean panjang dan setrika memperlama; lewat jam tutup lanjut besok.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from gedklin_ml.features import DRYER_PROCESSES, MACHINE_PROCESSES, count_loads

ROOT = Path(__file__).resolve().parents[1]
OPEN, CLOSE = time(8, 0), time(17, 0)
WASHERS, DRYERS, STAFF = 4, 3, 2
HOURLY_WEIGHT = {8: 3, 9: 4, 10: 3, 11: 2, 12: 1.5, 13: 1.5, 14: 1.5, 15: 2, 16: 3}
LAYANAN_P = {"C": 0.05, "CK": 0.12, "CKL": 0.38, "CKS": 0.35, "S": 0.05, "SATUAN": 0.05}
# Janji yang dikejar petugas di simulasi. Untuk C, CK, S, dan SATUAN janji mitra
# belum diketahui; nilai ini hanya asumsi untuk data dummy.
SIM_PROMISE_HOURS = {"C": 24, "CK": 36, "CKL": 48, "CKS": 96, "S": 48, "SATUAN": 48}
EXPRESS_PROMISE_HOURS = 24

WASH_MIN, DRY_MIN = 50, 60
FOLD_MIN_PER_LOAD, IRON_MIN_PER_KG, PACK_MIN = 12, 12, 5
KHUSUS_MIN_PER_PCS, SATUAN_MIN_PER_PCS = 10, 15


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
            orders.append(
                {
                    "received_at": datetime.combine(d, time(int(h), int(rng.integers(0, 60)))),
                    "layanan_utama": layanan,
                    "express": bool(rng.random() < 0.15),
                    "berat_kg": berat,
                    "pcs_khusus": pcs_khusus,
                    "pcs_satuan": pcs_satuan,
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


def make_job(rng: np.random.Generator, o: dict) -> Job:
    layanan, kg = o["layanan_utama"], o["berat_kg"]
    loads = count_loads(kg, 7, 1) if layanan in MACHINE_PROCESSES and kg > 0 else 0
    loads += math.ceil(o["pcs_khusus"] / 2)
    staff = PACK_MIN + KHUSUS_MIN_PER_PCS * o["pcs_khusus"] + SATUAN_MIN_PER_PCS * o["pcs_satuan"]
    if layanan == "CKL":
        staff += FOLD_MIN_PER_LOAD * loads
    if layanan in ("CKS", "S"):
        staff += IRON_MIN_PER_KG * kg
    promise = EXPRESS_PROMISE_HOURS if o["express"] else SIM_PROMISE_HOURS[layanan]
    # Pesanan baru dikerjakan menjelang janjinya (Express hampir langsung).
    lead = max(0.0, promise - float(rng.uniform(16, 30)))
    return Job(
        order=o,
        priority=(0 if o["express"] else 1, o["received_at"], o["order_id"]),
        eligible_at=o["received_at"] + timedelta(hours=lead),
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
            "ada_setrika",
        ]
    ]
    for col in ("received_at", "ready_at"):
        df[col] = df[col].dt.strftime("%Y-%m-%d %H:%M")
    df["express"] = df["express"].astype(int)
    df["ada_setrika"] = df["ada_setrika"].astype(int)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out_dir / "orders_dummy.csv", index=False)
    daily.to_csv(args.out_dir / "daily_dummy.csv", index=False)
    print(f"[DUMMY] {len(df)} pesanan, {len(daily)} hari -> {args.out_dir}")


if __name__ == "__main__":
    main()
