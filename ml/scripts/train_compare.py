"""Bandingkan baseline janji mitra, baseline median, Linear Regression, Random Forest, dan XGBoost.

Membaca tabel fitur hasil build_dataset.py. Split berdasarkan waktu: hari-hari
terakhir (`--test-days`) menjadi data uji. Semua durasi dan error dalam jam.
Model dengan MAE terkecil disimpan ke ml/models/best_model.joblib + metadata.json.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import RegressorMixin
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from gedklin_ml.baseline import GroupMedianRegressor, PromiseBaseline
from gedklin_ml.features import FEATURE_ORDER, TARGET

ROOT = Path(__file__).resolve().parents[1]
BASELINES = ("promise_baseline", "median_baseline")


def candidates(seed: int) -> dict[str, RegressorMixin]:
    return {
        "promise_baseline": PromiseBaseline(),
        "median_baseline": GroupMedianRegressor(),
        "linear_regression": make_pipeline(StandardScaler(), LinearRegression()),
        "random_forest": RandomForestRegressor(
            n_estimators=300, min_samples_leaf=3, random_state=seed, n_jobs=-1
        ),
        "xgboost": XGBRegressor(
            n_estimators=400,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            random_state=seed,
        ),
    }


def evaluate(y_true: np.ndarray, y_pred: np.ndarray, tolerance_hours: float) -> dict[str, float]:
    err = np.abs(y_true - y_pred)
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "r2": float(r2_score(y_true, y_pred)),
        "pct_within_tolerance": float((err < tolerance_hours).mean() * 100),
    }


def group_mae(test: pd.DataFrame, preds: dict[str, np.ndarray]) -> pd.DataFrame:
    """MAE per max_process_level dan per Reguler/Express."""
    groups = {
        "max_process_level": test["max_process_level"].astype(int).astype(str),
        "kecepatan": np.where(test["is_express"] >= 0.5, "Express", "Reguler"),
    }
    y = test[TARGET].to_numpy()
    rows = []
    for name, pred in preds.items():
        err = pd.Series(np.abs(y - pred), index=test.index)
        for group_type, labels in groups.items():
            for label, e in err.groupby(np.asarray(labels)):
                rows.append(
                    {
                        "model": name,
                        "group_type": group_type,
                        "group": label,
                        "n": len(e),
                        "mae": float(e.mean()),
                    }
                )
    return pd.DataFrame(rows)


def time_split(frame: pd.DataFrame, test_days: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    cutoff = frame["received_at"].max() - timedelta(days=test_days)
    return frame[frame["received_at"] <= cutoff], frame[frame["received_at"] > cutoff]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--features", type=Path, default=ROOT / "data" / "processed" / "features.csv"
    )
    parser.add_argument("--test-days", type=int, default=7)
    parser.add_argument(
        "--tolerance-hours",
        type=float,
        default=float(os.environ.get("ETA_TOLERANCE_HOURS", 6)),
        help="Batas error untuk metrik persentase prediksi tepat (ETA_TOLERANCE_HOURS)",
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not args.features.exists():
        raise SystemExit(f"{args.features} belum ada. Jalankan scripts/build_dataset.py dulu.")
    frame = pd.read_csv(args.features)
    source = str(frame["data_source"].iloc[0]) if "data_source" in frame else "custom"
    if source == "dummy":
        print("!! PERINGATAN: memakai DATA DUMMY. Metrik ini TIDAK boleh dilaporkan sebagai hasil.")

    frame["received_at"] = pd.to_datetime(frame["received_at"], utc=True)
    train, test = time_split(frame, args.test_days)
    print(f"Train: {len(train)} baris, Test: {len(test)} baris")

    X_train, y_train = train[FEATURE_ORDER], train[TARGET].to_numpy()
    X_test, y_test = test[FEATURE_ORDER], test[TARGET].to_numpy()

    results = []
    fitted: dict[str, RegressorMixin] = {}
    preds: dict[str, np.ndarray] = {}
    for name, model in candidates(args.seed).items():
        model.fit(X_train, y_train)
        preds[name] = model.predict(X_test)
        results.append({"model": name, **evaluate(y_test, preds[name], args.tolerance_hours)})
        fitted[name] = model

    report = pd.DataFrame(results).sort_values("mae").reset_index(drop=True)
    report.insert(0, "data_source", source)
    by_group = group_mae(test, preds)
    by_group.insert(0, "data_source", source)

    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    # Laporan dari data dummy diberi nama terpisah dan tidak di-commit.
    suffix = "_dummy" if source == "dummy" else ""
    report.to_csv(reports_dir / f"comparison{suffix}.csv", index=False)
    by_group.to_csv(reports_dir / f"comparison_by_group{suffix}.csv", index=False)
    print(f"Error dalam jam, toleransi {args.tolerance_hours:g} jam")
    print(report.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print()
    print(
        by_group.pivot_table(index=["group_type", "group"], columns="model", values="mae")
        .round(2)
        .to_string()
    )

    best_name = str(report.loc[0, "model"])
    best_mae = float(report.loc[0, "mae"])
    baseline_mae = {
        name: float(report.loc[report["model"] == name, "mae"].iloc[0]) for name in BASELINES
    }
    trained_at = datetime.now(UTC)
    metadata = {
        "model_name": best_name,
        "model_version": f"{best_name}-{trained_at:%Y%m%d%H%M%S}",
        "data_source": source,
        "features": FEATURE_ORDER,
        "target": TARGET,
        "unit": "hours",
        "trained_at": trained_at.isoformat(),
        "train_rows": len(train),
        "test_rows": len(test),
        "eta_tolerance_hours": args.tolerance_hours,
        "metrics": report.loc[0, ["mae", "rmse", "r2", "pct_within_tolerance"]].to_dict(),
        "baseline_mae": baseline_mae,
        "beats_baselines": all(best_mae < mae for mae in baseline_mae.values()),
    }

    models_dir = ROOT / "models"
    models_dir.mkdir(exist_ok=True)
    joblib.dump(fitted[best_name], models_dir / "best_model.joblib")
    (models_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, default=float))
    print(f"\nModel terbaik: {best_name} (MAE {best_mae:.1f} jam)")
    if not metadata["beats_baselines"]:
        print("!! Model terbaik belum mengalahkan kedua baseline.")


if __name__ == "__main__":
    main()
