"""Ubah data mentah form pencatatan menjadi tabel fitur di ml/data/processed/features.csv."""

from __future__ import annotations

import argparse
from pathlib import Path

from gedklin_ml.data import CATALOG_PATH, prepare_dataset

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"


def resolve_inputs(orders: Path | None, daily: Path | None) -> tuple[Path, Path, str]:
    if orders and daily:
        return orders, daily, "dummy" if "dummy" in orders.name else "custom"
    if (RAW / "orders.csv").exists() and (RAW / "daily.csv").exists():
        return RAW / "orders.csv", RAW / "daily.csv", "mitra"
    return RAW / "orders_dummy.csv", RAW / "daily_dummy.csv", "dummy"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orders", type=Path)
    parser.add_argument("--daily", type=Path)
    parser.add_argument("--catalog", type=Path, default=CATALOG_PATH)
    parser.add_argument("--skip-days", type=int, default=2)
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "processed" / "features.csv")
    args = parser.parse_args()

    orders, daily, source = resolve_inputs(args.orders, args.daily)
    frame = prepare_dataset(orders, daily, skip_days=args.skip_days, catalog_path=args.catalog)
    # Dibaca train_compare.py supaya hasil dari data dummy tidak tertukar dengan data mitra.
    frame.insert(0, "data_source", source)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.out, index=False)
    print(f"[{source.upper()}] {len(frame)} baris fitur -> {args.out}")


if __name__ == "__main__":
    main()
