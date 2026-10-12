"""Prediksi durasi pesanan (menit) dari model ML, dengan fallback baseline median.

Aplikasi tidak boleh crash karena model: semua kegagalan memuat atau prediksi
jatuh ke baseline median per (service_type, is_express).
"""

from __future__ import annotations

import json
import logging
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import get_settings
from gedklin_ml.baseline import DEFAULT_MEDIANS, group_key
from gedklin_ml.features import FEATURE_ORDER, to_vector

logger = logging.getLogger(__name__)

BASELINE_VERSION = "baseline-median"


class EtaPredictor:
    def __init__(self, model_path: str | Path | None) -> None:
        self.model: Any = None
        self.model_version = BASELINE_VERSION
        self.medians: dict[str, float] = dict(DEFAULT_MEDIANS)
        if model_path:
            self._load(Path(model_path))

    def _load(self, model_path: Path) -> None:
        meta_path = model_path.with_name("metadata.json")
        try:
            if meta_path.exists():
                meta = json.loads(meta_path.read_text())
                self.medians.update(meta.get("baseline_medians", {}))
                if meta.get("features") != FEATURE_ORDER:
                    logger.error(
                        "Urutan fitur model tidak cocok dengan FEATURE_ORDER, pakai baseline"
                    )
                    return
                version = str(meta.get("model_version", "unknown"))
            else:
                version = "unknown"
            if not model_path.exists():
                logger.warning("Model tidak ditemukan di %s, pakai baseline median", model_path)
                return
            import joblib

            self.model = joblib.load(model_path)
            self.model_version = version
            logger.info("Model ETA dimuat: %s", version)
        except Exception:
            logger.exception("Gagal memuat model ETA, pakai baseline median")
            self.model = None
            self.model_version = BASELINE_VERSION

    def baseline_minutes(self, features: dict[str, float]) -> float:
        return float(self.medians[group_key(features["is_cks"], features["is_express"])])

    def predict_minutes(self, features: dict[str, float]) -> tuple[float, str]:
        if self.model is not None:
            try:
                import pandas as pd

                X = pd.DataFrame([to_vector(features)], columns=FEATURE_ORDER)
                value = float(self.model.predict(X)[0])
                if math.isfinite(value) and value > 0:
                    return value, self.model_version
                logger.warning("Prediksi model tidak valid (%s), pakai baseline", value)
            except Exception:
                logger.exception("Prediksi model gagal, pakai baseline median")
        return self.baseline_minutes(features), BASELINE_VERSION


@lru_cache
def get_predictor() -> EtaPredictor:
    return EtaPredictor(get_settings().model_path)
