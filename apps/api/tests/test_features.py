from datetime import UTC, datetime, time

from gedklin_ml.features import FEATURE_ORDER, QueueRecord, build_features, queue_stats, to_vector

T0 = datetime(2026, 10, 20, 3, 0, tzinfo=UTC)  # 10:00 WIB, Selasa


def test_queue_stats_only_counts_orders_active_at_time() -> None:
    records = [
        QueueRecord(datetime(2026, 10, 20, 1, 0, tzinfo=UTC), None, 2.0),
        QueueRecord(
            datetime(2026, 10, 20, 1, 0, tzinfo=UTC),
            datetime(2026, 10, 20, 4, 0, tzinfo=UTC),
            3.0,
        ),
        # Sudah READY sebelum T0: tidak dihitung.
        QueueRecord(
            datetime(2026, 10, 19, 1, 0, tzinfo=UTC),
            datetime(2026, 10, 20, 2, 0, tzinfo=UTC),
            5.0,
        ),
        # Masuk setelah T0 (informasi masa depan): tidak dihitung.
        QueueRecord(datetime(2026, 10, 20, 5, 0, tzinfo=UTC), None, 7.0),
    ]
    assert queue_stats(T0, records) == (2, 5.0)


def test_build_features_uses_local_time() -> None:
    feats = build_features(
        received_at=T0,
        weight_kg=4,
        service_type="CKS",
        is_express=True,
        active_orders_count=3,
        active_kg_total=9.5,
        staff_on_duty=2,
        close_time=time(21, 0),
    )
    assert feats["hour_of_day"] == 10
    assert feats["day_of_week"] == 1
    assert feats["minutes_to_close"] == 11 * 60
    assert feats["is_cks"] == 1.0 and feats["is_express"] == 1.0
    assert len(to_vector(feats)) == len(FEATURE_ORDER)
