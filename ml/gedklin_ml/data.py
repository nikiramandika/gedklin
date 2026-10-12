"""Memuat data mentah dari form pencatatan mitra.

Waktu di CSV ditulis dalam waktu lokal (Asia/Jakarta) tanpa zona waktu,
lalu dikonversi ke UTC di sini.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from gedklin_ml.features import LOCAL_TZ

ORDER_COLUMNS = ["order_id", "received_at", "weight_kg", "service_type", "is_express", "ready_at"]
DAILY_COLUMNS = ["date", "staff_on_duty", "open_time", "close_time"]


def _local_to_utc(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series).dt.tz_localize(LOCAL_TZ).dt.tz_convert("UTC")


def load_orders(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = set(ORDER_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"Kolom hilang di {path}: {sorted(missing)}")
    df = df[ORDER_COLUMNS].copy()
    df["received_at"] = _local_to_utc(df["received_at"])
    df["ready_at"] = _local_to_utc(df["ready_at"])
    df["is_express"] = df["is_express"].astype(str).str.lower().isin(["1", "true", "ya", "y"])
    df["service_type"] = df["service_type"].str.upper().str.strip()
    df = df.dropna(subset=["received_at", "ready_at", "weight_kg"])
    df = df[df["ready_at"] > df["received_at"]]
    return df.sort_values("received_at").reset_index(drop=True)


def load_daily(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = set(DAILY_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"Kolom hilang di {path}: {sorted(missing)}")
    df = df[DAILY_COLUMNS].copy()
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["open_time"] = pd.to_datetime(df["open_time"], format="%H:%M").dt.time
    df["close_time"] = pd.to_datetime(df["close_time"], format="%H:%M").dt.time
    return df


def prepare_dataset(orders_path: Path, daily_path: Path, skip_days: int = 2) -> pd.DataFrame:
    """Muat data mentah, bangun fitur, lalu buang `skip_days` hari pertama.

    Hari-hari awal dibuang setelah fitur dihitung, karena stok cucian awal
    sering tidak tercatat sehingga fitur antrean di hari itu terlalu rendah.
    Pesanan hari-hari awal tetap dipakai untuk menghitung antrean hari berikutnya.
    """
    from gedklin_ml.features import build_feature_frame, local_date

    orders = load_orders(orders_path)
    daily = load_daily(daily_path)
    frame = build_feature_frame(orders, daily)
    if skip_days > 0 and not frame.empty:
        days = frame["received_at"].map(lambda ts: local_date(ts.to_pydatetime()))
        cutoff = sorted(days.unique())[min(skip_days, days.nunique() - 1)]
        frame = frame[days >= cutoff].reset_index(drop=True)
    return frame
