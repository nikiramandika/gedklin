from datetime import date, time

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import DailyOperation
from app.services.app_settings import day_ops_lookup, load_app_config

SUNDAY = date(2026, 10, 25)
MONDAY = date(2026, 10, 26)


def test_catalog_seeds_sunday_as_routine_closed_day(client: TestClient, owner: dict) -> None:
    assert client.get("/settings", headers=owner).json()["closed_weekdays"] == [6]


def test_routine_closed_day_is_closed_unless_daily_row_says_otherwise(db: Session) -> None:
    lookup = day_ops_lookup(db, load_app_config(db))
    assert lookup(SUNDAY).is_open is False
    assert lookup(MONDAY).is_open is True

    # Pemilik membuka toko pada Minggu tertentu lewat data harian.
    db.add(DailyOperation(date=SUNDAY, is_open=True, open_time=time(9, 0), close_time=time(14, 0)))
    db.commit()
    lookup = day_ops_lookup(db, load_app_config(db))
    assert lookup(SUNDAY).is_open is True
    assert lookup(SUNDAY).close_time == time(14, 0)


def test_owner_updates_closed_weekdays(client: TestClient, owner: dict, cashier: dict) -> None:
    res = client.put("/settings", json={"closed_weekdays": [6, 0, 6]}, headers=owner)
    assert res.status_code == 200 and res.json()["closed_weekdays"] == [0, 6]

    res = client.put("/settings", json={"closed_weekdays": []}, headers=owner)
    assert res.status_code == 200 and res.json()["closed_weekdays"] == []

    assert client.put("/settings", json={"closed_weekdays": [7]}, headers=owner).status_code == 422
    every_day = list(range(7))
    res = client.put("/settings", json={"closed_weekdays": every_day}, headers=owner)
    assert res.status_code == 422
    res = client.put("/settings", json={"closed_weekdays": [6]}, headers=cashier)
    assert res.status_code == 403

    logs = client.get("/activity-logs", params={"entity_type": "settings"}, headers=owner).json()
    assert any("closed_weekdays" in (entry["changes"] or {}) for entry in logs)
