import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.services.eta import PROMISE_VERSION, EtaPredictor
from gedklin_ml.features import FEATURE_ORDER, DayOps, QueueStats, build_features, content_from_form

FEATURES = build_features(
    received_at=datetime(2026, 10, 20, 3, 0, tzinfo=UTC),
    content=content_from_form(
        layanan_utama="CKS",
        express=False,
        berat_kg=6,
        pcs_khusus=0,
        pcs_satuan=0,
        pcs_dry_clean=0,
        ada_setrika=True,
    ),
    queue=QueueStats(count=10, express_count=2, loads=12, dry_loads=10, ironing_kg=20),
    day=DayOps(),
    promised_hours=96,
)
REAL_MODEL = Path(__file__).resolve().parents[3] / "ml" / "models" / "best_model.joblib"


def test_missing_model_falls_back_to_promise() -> None:
    predictor = EtaPredictor("/tidak/ada/model.joblib")
    assert predictor.predict_hours(FEATURES) == (None, PROMISE_VERSION)


def test_corrupt_model_falls_back_to_promise(tmp_path: Path) -> None:
    bad = tmp_path / "best_model.joblib"
    bad.write_bytes(b"bukan model")
    (tmp_path / "metadata.json").write_text(
        json.dumps({"features": FEATURE_ORDER, "unit": "hours", "model_version": "x"})
    )
    predictor = EtaPredictor(bad)
    assert predictor.predict_hours(FEATURES) == (None, PROMISE_VERSION)


def test_model_with_old_features_is_not_used(tmp_path: Path) -> None:
    model = tmp_path / "best_model.joblib"
    model.write_bytes(b"x")
    (tmp_path / "metadata.json").write_text(json.dumps({"features": ["weight_kg"]}))
    assert EtaPredictor(model).model_version == PROMISE_VERSION


@pytest.mark.skipif(not REAL_MODEL.exists(), reason="model belum dilatih")
def test_trained_model_predicts() -> None:
    predictor = EtaPredictor(REAL_MODEL)
    hours, version = predictor.predict_hours(FEATURES)
    assert version != PROMISE_VERSION
    assert hours is not None and hours > 0
