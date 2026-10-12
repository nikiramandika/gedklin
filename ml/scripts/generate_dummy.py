"""Generate data dummy dengan kolom yang sama persis dengan form pencatatan mitra.

HANYA untuk menguji pipeline dan aplikasi. Metrik dari data ini tidak boleh
dilaporkan sebagai hasil.

Pola yang disimulasikan:
- Jam ramai pagi (08-10) dan sore (16-19), akhir pekan lebih ramai.
- Durasi kerja dasar beda per layanan (CKS ada tahap setrika).
- Petugas memproses antrean Express dulu, lalu FIFO, sehingga antrean panjang
  memperlama pesanan Reguler.
- Pekerjaan berhenti saat tutup dan lanjut besok saat buka.
"""

from __future__ import annotations

import argparse
import heapq
from datetime import date, datetime, time, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
HOURLY_WEIGHT = {
    8: 3,
    9: 4,
    10: 3,
    11: 2,
    12: 1.5,
    13: 1.5,
    14: 1.5,
    15: 2,
    16: 3,
    17: 3.5,
    18: 3,
    19: 2,
    20: 1,
}


def daily_schedule(rng: np.random.Generator, start: date, days: int) -> pd.DataFrame:
    rows = []
    for i in range(days):
        d = start + timedelta(days=i)
        weekend = d.weekday() >= 5
        rows.append(
            {
                "date": d.isoformat(),
                "staff_on_duty": int(rng.choice([2, 3], p=[0.3, 0.7] if weekend else [0.6, 0.4])),
                "open_time": "08:00",
                "close_time": "18:00" if d.weekday() == 6 else "21:00",
            }
        )
    return pd.DataFrame(rows)


def arrivals(rng: np.random.Generator, daily: pd.DataFrame) -> list[dict]:
    orders = []
    for row in daily.itertuples(index=False):
        d = date.fromisoformat(row.date)
        close_h = int(row.close_time[:2])
        n = int(rng.poisson(38 if d.weekday() >= 5 else 28))
        hours = [h for h in HOURLY_WEIGHT if h < close_h]
        p = np.array([HOURLY_WEIGHT[h] for h in hours], dtype=float)
        for h in rng.choice(hours, size=n, p=p / p.sum()):
            received = datetime.combine(d, time(int(h), int(rng.integers(0, 60))))
            service = "CKS" if rng.random() < 0.55 else "CK"
            orders.append(
                {
                    "received_at": received,
                    "weight_kg": round(float(np.clip(rng.gamma(3.0, 1.3), 1.0, 15.0)), 1),
                    "service_type": service,
                    "is_express": bool(rng.random() < 0.2),
                }
            )
    orders.sort(key=lambda o: o["received_at"])
    for i, o in enumerate(orders, start=1):
        o["order_id"] = f"GK-{i:05d}"
    return orders


def machine_minutes(order: dict) -> float:
    """Durasi minimum mesin + setrika, batas bawah waktu selesai."""
    kg = order["weight_kg"]
    iron = 4.5 * kg if order["service_type"] == "CKS" else 0
    return 50 + 3 * kg + 55 + 3 * kg + iron + 8


def work_minutes(rng: np.random.Generator, order: dict) -> float:
    """Waktu sentuh petugas per pesanan (mesin berjalan paralel)."""
    kg = order["weight_kg"]
    machine_touch = (105 + 6 * kg) * 0.3
    iron = 4.5 * kg if order["service_type"] == "CKS" else 0
    return float(machine_touch + iron + 8) * float(rng.lognormal(0, 0.15))


def simulate(rng: np.random.Generator, orders: list[dict], daily: pd.DataFrame) -> None:
    sched = {
        date.fromisoformat(r.date): (
            int(r.staff_on_duty),
            datetime.combine(date.fromisoformat(r.date), time.fromisoformat(r.open_time)),
            datetime.combine(date.fromisoformat(r.date), time.fromisoformat(r.close_time)),
        )
        for r in daily.itertuples(index=False)
    }
    remaining = {o["order_id"]: work_minutes(rng, o) for o in orders}
    queue: list[tuple[int, datetime, str]] = []
    pending = list(orders)
    by_id = {o["order_id"]: o for o in orders}
    in_progress: dict[int, str] = {}

    for d in sorted(sched):
        staff, open_dt, close_dt = sched[d]
        t = open_dt
        while t < close_dt:
            while pending and pending[0]["received_at"] <= t:
                o = pending.pop(0)
                heapq.heappush(
                    queue, (0 if o["is_express"] else 1, o["received_at"], o["order_id"])
                )
            for w in range(staff):
                if w not in in_progress and queue:
                    in_progress[w] = heapq.heappop(queue)[2]
                if w in in_progress:
                    oid = in_progress[w]
                    remaining[oid] -= 1
                    if remaining[oid] <= 0:
                        o = by_id[oid]
                        floor = o["received_at"] + timedelta(minutes=machine_minutes(o))
                        o["ready_at"] = max(t + timedelta(minutes=1), floor)
                        del in_progress[w]
            t += timedelta(minutes=1)
        # Petugas yang tidak masuk besok menyerahkan pekerjaannya kembali ke antrean.
        for oid in in_progress.values():
            o = by_id[oid]
            heapq.heappush(queue, (0 if o["is_express"] else 1, o["received_at"], oid))
        in_progress.clear()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--start", default="2026-10-14")
    parser.add_argument("--days", type=int, default=25)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "data" / "raw")
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    # Simulasi diperpanjang 7 hari supaya pesanan di hari terakhir sempat selesai.
    daily_all = daily_schedule(rng, date.fromisoformat(args.start), args.days + 7)
    daily = daily_all.iloc[: args.days]
    orders = arrivals(rng, daily)
    simulate(rng, orders, daily_all)

    df = pd.DataFrame([o for o in orders if "ready_at" in o])
    df = df[["order_id", "received_at", "weight_kg", "service_type", "is_express", "ready_at"]]
    for col in ("received_at", "ready_at"):
        df[col] = df[col].dt.strftime("%Y-%m-%d %H:%M")
    df["is_express"] = df["is_express"].astype(int)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out_dir / "orders_dummy.csv", index=False)
    daily.to_csv(args.out_dir / "daily_dummy.csv", index=False)
    print(f"[DUMMY] {len(df)} pesanan, {len(daily)} hari -> {args.out_dir}")


if __name__ == "__main__":
    main()
