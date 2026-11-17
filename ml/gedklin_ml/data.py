from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from gedklin_ml.features import (
    DEFAULT_DAY_OPS,
    DEFAULT_PROMISE_HOURS,
    LOCAL_TZ,
    MACHINE_CAPACITY_KG,
    Promise,
)

ORDER_COLUMNS = [
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
DAILY_COLUMNS = [
    "date",
    "staff_on_duty",
    "washers_available",
    "dryers_available",
    "open_time",
    "close_time",
]
CATALOG_PATH = Path(__file__).resolve().parents[2] / "apps" / "api" / "seed" / "price_catalog.json"

_TRUE = ["1", "true", "ya", "y"]


def _local_to_utc(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series).dt.tz_localize(LOCAL_TZ).dt.tz_convert("UTC")


def _flag(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.lower().isin(_TRUE)


def _require(df: pd.DataFrame, columns: list[str], path: Path) -> None:
    missing = set(columns) - set(df.columns)
    if missing:
        raise ValueError(f"Kolom hilang di {path}: {sorted(missing)}")


def load_orders(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    _require(df, ORDER_COLUMNS, path)
    df = df[ORDER_COLUMNS].copy()
    df["received_at"] = _local_to_utc(df["received_at"])
    df["ready_at"] = _local_to_utc(df["ready_at"])
    df["layanan_utama"] = df["layanan_utama"].astype(str).str.upper().str.strip()
    df["express"] = _flag(df["express"])
    df["ada_setrika"] = _flag(df["ada_setrika"])
    df["berat_kg"] = pd.to_numeric(df["berat_kg"], errors="coerce").fillna(0.0)
    for col in ("pcs_khusus", "pcs_satuan", "pcs_dry_clean"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
    df = df.dropna(subset=["received_at", "ready_at"])
    df = df[df["ready_at"] > df["received_at"]]
    return df.sort_values("received_at").reset_index(drop=True)


def load_daily(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    _require(df, ["date", "staff_on_duty", "open_time", "close_time"], path)
    df["washers_available"] = df.get("washers_available", DEFAULT_DAY_OPS.washers_available)
    df["dryers_available"] = df.get("dryers_available", DEFAULT_DAY_OPS.dryers_available)
    df["washers_available"] = df["washers_available"].fillna(DEFAULT_DAY_OPS.washers_available)
    df["dryers_available"] = df["dryers_available"].fillna(DEFAULT_DAY_OPS.dryers_available)
    columns = DAILY_COLUMNS + (["is_open"] if "is_open" in df.columns else [])
    df = df[columns].copy()
    if "is_open" in df.columns:
        df["is_open"] = _flag(df["is_open"])
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["open_time"] = pd.to_datetime(df["open_time"], format="%H:%M").dt.time
    df["close_time"] = pd.to_datetime(df["close_time"], format="%H:%M").dt.time
    return df


def _express_processes(catalog: dict) -> set[str]:
    return {e["process"] for e in catalog["kiloan"] if e.get("express_eligible")}


def load_promises(path: Path = CATALOG_PATH) -> tuple[dict[str, Promise], float]:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    data = catalog["promise_hours"]
    express = data.get("express")
    eligible = _express_processes(catalog)
    promises = {
        process: Promise(
            regular_hours=hours, express_hours=express if process in eligible else None
        )
        for process, hours in data["regular"].items()
    }
    return promises, float(data.get("default", DEFAULT_PROMISE_HOURS))


def load_machine_capacity(path: Path = CATALOG_PATH) -> float:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    return float(catalog.get("machine_capacity_kg", MACHINE_CAPACITY_KG))


def prepare_dataset(
    orders_path: Path,
    daily_path: Path,
    skip_days: int = 2,
    catalog_path: Path = CATALOG_PATH,
) -> pd.DataFrame:
    from gedklin_ml.features import build_feature_frame, local_date

    orders = load_orders(orders_path)
    daily = load_daily(daily_path)
    promises, default_hours = load_promises(catalog_path)
    frame = build_feature_frame(
        orders, daily, promises, default_hours, load_machine_capacity(catalog_path)
    )
    if skip_days > 0 and not frame.empty:
        days = frame["received_at"].map(lambda ts: local_date(ts.to_pydatetime()))
        cutoff = sorted(days.unique())[min(skip_days, days.nunique() - 1)]
        frame = frame[days >= cutoff].reset_index(drop=True)
    return frame
