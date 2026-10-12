"""Bandingkan baseline median, Linear Regression, Random Forest, dan XGBoost.

Split berdasarkan waktu: hari-hari terakhir (`--test-days`) menjadi data uji.
Model dengan MAE terkecil disimpan ke ml/models/best_model.joblib + metadata.json.
"""

from __future__ import annotations

import argparse
import json
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

from build_features import resolve_inputs
from gedklin_ml.baseline import GroupMedianRegressor
from gedklin_ml.data import prepare_dataset
from gedklin_ml.features import FEATURE_ORDER, TARGET

ROOT = Path(__file__).resolve().parents[1]


def candidates(seed: int) -> dict[str, RegressorMixin]:
    return {
        "baseline_median": GroupMedianRegressor(),
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


def evaluate(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    err = np.abs(y_true - y_pred)
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "r2": float(r2_score(y_true, y_pred)),
        "pct_err_lt_30": float((err < 30).mean() * 100),
    }


def time_split(frame: pd.DataFrame, test_days: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    cutoff = frame["received_at"].max() - timedelta(days=test_days)
    return frame[frame["received_at"] <= cutoff], frame[frame["received_at"] > cutoff]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--orders", type=Path)
    parser.add_argument("--daily", type=Path)
    parser.add_argument("--skip-days", type=int, default=2)
    parser.add_argument("--test-days", type=int, default=7)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    orders, daily, source = resolve_inputs(args.orders, args.daily)
    if source == "dummy":
        print("!! PERINGATAN: memakai DATA DUMMY. Metrik ini TIDAK boleh dilaporkan sebagai hasil.")

    frame = prepare_dataset(orders, daily, skip_days=args.skip_days)
    frame["received_at"] = pd.to_datetime(frame["received_at"], utc=True)
    train, test = time_split(frame, args.test_days)
    print(f"Train: {len(train)} baris, Test: {len(test)} baris")

    X_train, y_train = train[FEATURE_ORDER], train[TARGET].to_numpy()
    X_test, y_test = test[FEATURE_ORDER], test[TARGET].to_numpy()

    results = []
    fitted: dict[str, RegressorMixin] = {}
    for name, model in candidates(args.seed).items():
        model.fit(X_train, y_train)
        metrics = evaluate(y_test, model.predict(X_test))
        results.append({"model": name, **metrics})
        fitted[name] = model

    report = pd.DataFrame(results).sort_values("mae").reset_index(drop=True)
    report.insert(0, "data_source", source)
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    # Laporan dari data dummy diberi nama terpisah dan tidak di-commit.
    report_name = "comparison_dummy.csv" if source == "dummy" else "comparison.csv"
    report.to_csv(reports_dir / report_name, index=False)
    print(report.to_string(index=False, float_format=lambda v: f"{v:.2f}"))

    best_name = str(report.loc[0, "model"])
    baseline_mae = float(report.loc[report["model"] == "baseline_median", "mae"].iloc[0])
    trained_at = datetime.now(UTC)
    baseline: GroupMedianRegressor = fitted["baseline_median"]  # type: ignore[assignment]
    metadata = {
        "model_name": best_name,
        "model_version": f"{best_name}-{trained_at:%Y%m%d%H%M%S}",
        "data_source": source,
        "features": FEATURE_ORDER,
        "target": TARGET,
        "trained_at": trained_at.isoformat(),
        "train_rows": len(train),
        "test_rows": len(test),
        "metrics": report.loc[0, ["mae", "rmse", "r2", "pct_err_lt_30"]].to_dict(),
        "baseline_mae": baseline_mae,
        "beats_baseline": float(report.loc[0, "mae"]) < baseline_mae,
        "baseline_medians": baseline.medians_,
    }

    models_dir = ROOT / "models"
    models_dir.mkdir(exist_ok=True)
    joblib.dump(fitted[best_name], models_dir / "best_model.joblib")
    (models_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, default=float))
    print(f"Model terbaik: {best_name} (MAE {metadata['metrics']['mae']:.1f} menit)")


if __name__ == "__main__":
    main()
