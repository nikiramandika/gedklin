from datetime import UTC, datetime, time
from pathlib import Path

import pytest

from app.services.eta import BASELINE_VERSION, EtaPredictor
from gedklin_ml.features import build_features

FEATURES = build_features(
    received_at=datetime(2026, 10, 20, 3, 0, tzinfo=UTC),
    weight_kg=4,
    service_type="CKS",
    is_express=False,
    active_orders_count=10,
    active_kg_total=40,
    staff_on_duty=2,
    close_time=time(21, 0),
)
REAL_MODEL = Path(__file__).resolve().parents[3] / "ml" / "models" / "best_model.joblib"


def test_missing_model_falls_back_to_baseline() -> None:
    predictor = EtaPredictor("/tidak/ada/model.joblib")
    minutes, version = predictor.predict_minutes(FEATURES)
    assert version == BASELINE_VERSION
    assert minutes > 0


def test_corrupt_model_falls_back_to_baseline(tmp_path: Path) -> None:
    bad = tmp_path / "best_model.joblib"
    bad.write_bytes(b"bukan model")
    predictor = EtaPredictor(bad)
    assert predictor.predict_minutes(FEATURES)[1] == BASELINE_VERSION


@pytest.mark.skipif(not REAL_MODEL.exists(), reason="model belum dilatih")
def test_trained_model_predicts() -> None:
    predictor = EtaPredictor(REAL_MODEL)
    minutes, version = predictor.predict_minutes(FEATURES)
    assert version != BASELINE_VERSION
    assert minutes > 0
