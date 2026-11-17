"""Baseline pembanding di eksperimen.

- `PromiseBaseline`: prediksi = janji standar mitra (`promised_hours`). Ini kondisi
  saat ini yang ingin dikalahkan, dan juga fallback ETA di API.
- `GroupMedianRegressor`: median target (jam kerja) per (`max_process_level`, `is_express`).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin


class PromiseBaseline(BaseEstimator, RegressorMixin):
    def fit(self, X: pd.DataFrame, y: pd.Series | np.ndarray) -> PromiseBaseline:
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return X["promised_hours"].to_numpy(dtype=float)


def group_key(max_process_level: float, is_express: float) -> str:
    return f"{int(max_process_level)}|{int(is_express >= 0.5)}"


class GroupMedianRegressor(BaseEstimator, RegressorMixin):
    def _keys(self, X: pd.DataFrame) -> list[str]:
        return [
            group_key(level, express)
            for level, express in zip(X["max_process_level"], X["is_express"], strict=True)
        ]

    def fit(self, X: pd.DataFrame, y: pd.Series | np.ndarray) -> GroupMedianRegressor:
        df = pd.DataFrame({"key": self._keys(X), "y": np.asarray(y)})
        self.medians_: dict[str, float] = df.groupby("key")["y"].median().to_dict()
        self.global_median_: float = float(np.median(np.asarray(y)))
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return np.array(
            [self.medians_.get(k, self.global_median_) for k in self._keys(X)], dtype=float
        )
