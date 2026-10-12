"""Baseline median per (service_type, is_express).

Dipakai sebagai pembanding di eksperimen dan sebagai fallback ETA di API.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin

# Fallback terakhir jika belum ada model maupun metadata (menit).
# TODO: ganti dengan median dari data mitra setelah M4.
DEFAULT_MEDIANS: dict[str, float] = {
    "CK|0": 24 * 60,
    "CK|1": 8 * 60,
    "CKS|0": 48 * 60,
    "CKS|1": 12 * 60,
}


def group_key(is_cks: float, is_express: float) -> str:
    return f"{'CKS' if is_cks >= 0.5 else 'CK'}|{int(is_express >= 0.5)}"


class GroupMedianRegressor(BaseEstimator, RegressorMixin):
    def fit(self, X: pd.DataFrame, y: pd.Series | np.ndarray) -> GroupMedianRegressor:
        keys = [group_key(c, e) for c, e in zip(X["is_cks"], X["is_express"], strict=True)]
        df = pd.DataFrame({"key": keys, "y": np.asarray(y)})
        self.medians_: dict[str, float] = df.groupby("key")["y"].median().to_dict()
        self.global_median_: float = float(np.median(np.asarray(y)))
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return np.array(
            [
                self.medians_.get(group_key(c, e), self.global_median_)
                for c, e in zip(X["is_cks"], X["is_express"], strict=True)
            ],
            dtype=float,
        )
