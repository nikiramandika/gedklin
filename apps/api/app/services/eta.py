"""Prediksi durasi pesanan (jam) dari model ML.

Aplikasi tidak boleh crash karena model: bila model tidak ada, gagal dimuat,
atau prediksinya tidak valid, `predict_hours` mengembalikan None dan pemanggil
memakai `promised_ready_at` (janji standar mitra).
"""

from __future__ import annotations

import json
import logging
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import get_settings
from gedklin_ml.features import FEATURE_ORDER, to_vector

logger = logging.getLogger(__name__)

PROMISE_VERSION = "janji-mitra"


class EtaPredictor:
    def __init__(self, model_path: str | Path | None) -> None:
        self.model: Any = None
        self.model_version = PROMISE_VERSION
        if model_path:
            self._load(Path(model_path))

    def _load(self, model_path: Path) -> None:
        meta_path = model_path.with_name("metadata.json")
        try:
            if not model_path.exists():
                logger.warning("Model tidak ditemukan di %s, pakai janji mitra", model_path)
                return
            if not meta_path.exists():
                logger.error("metadata.json tidak ada di samping model, pakai janji mitra")
                return
            meta = json.loads(meta_path.read_text())
            if meta.get("features") != FEATURE_ORDER or meta.get("unit") != "hours":
                logger.error("Fitur/satuan model tidak cocok, pakai janji mitra")
                return
            import joblib

            self.model = joblib.load(model_path)
            self.model_version = str(meta.get("model_version", "unknown"))
            logger.info("Model ETA dimuat: %s", self.model_version)
        except Exception:
            logger.exception("Gagal memuat model ETA, pakai janji mitra")
            self.model = None
            self.model_version = PROMISE_VERSION

    def predict_hours(self, features: dict[str, float]) -> tuple[float | None, str]:
        if self.model is None:
            return None, PROMISE_VERSION
        try:
            import pandas as pd

            X = pd.DataFrame([to_vector(features)], columns=FEATURE_ORDER)
            value = float(self.model.predict(X)[0])
            if math.isfinite(value) and value > 0:
                return value, self.model_version
            logger.warning("Prediksi model tidak valid (%s), pakai janji mitra", value)
        except Exception:
            logger.exception("Prediksi model gagal, pakai janji mitra")
        return None, PROMISE_VERSION


@lru_cache
def get_predictor() -> EtaPredictor:
    return EtaPredictor(get_settings().model_path)
