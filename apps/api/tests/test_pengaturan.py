from fastapi.testclient import TestClient

from tests.conftest import new_order


def test_outlet_profile_and_cycle_times_saved_from_settings(
    client: TestClient, owner: dict, cashier: dict
) -> None:
    before = client.get("/settings", headers=owner).json()
    assert before["outlet_name"] == "Gedklin Laundry"
    assert before["wash_minutes_per_load"] == 60

    body = {
        "outlet_name": "  Gedklin Laundry Setia Budi ",
        "outlet_address": "Jl. Setia Budi No. 1, Medan",
        "outlet_phone": "0812-1111-2222",
        "wash_minutes_per_load": 45,
        "dry_minutes_per_load": 50,
        "iron_minutes_per_kg": 8,
        "iron_minutes_per_pcs": 4,
    }
    res = client.put("/settings", json=body, headers=owner)
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["outlet_name"] == "Gedklin Laundry Setia Budi"
    assert saved["iron_minutes_per_kg"] == 8

    log = client.get("/activity-logs", params={"entity_type": "settings"}, headers=owner).json()[0]
    assert log["changes"]["outlet_name"] == ["Gedklin Laundry", "Gedklin Laundry Setia Budi"]
    assert client.put("/settings", json=body, headers=cashier).status_code == 403


def test_settings_validation(client: TestClient, owner: dict) -> None:
    for body in (
        {"outlet_name": "   "},
        {"wash_minutes_per_load": 0},
        {"iron_minutes_per_kg": -1},
        {"outlet_phone": "1" * 31},
    ):
        assert client.put("/settings", json=body, headers=owner).status_code == 422, body


def test_outlet_name_on_receipt_tracking_and_public_endpoint(
    client: TestClient, owner: dict, cashier: dict
) -> None:
    client.put(
        "/settings",
        json={"outlet_name": "Laundry Uji", "outlet_phone": "061-123456"},
        headers=owner,
    )
    order = new_order(client, cashier)
    receipt = client.get(f"/orders/{order['id']}/receipt", headers=cashier).json()
    assert receipt["message"].startswith("Nota Laundry Uji\n061-123456\n")
    assert receipt["outlet"] == {"name": "Laundry Uji", "address": "", "phone": "061-123456"}

    tracking = client.get(f"/public/track/{order['tracking_code']}").json()
    assert tracking["outlet"]["name"] == "Laundry Uji"
    assert client.get("/public/outlet").json()["phone"] == "061-123456"


def test_cycle_times_change_queue_estimate(client: TestClient, owner: dict, cashier: dict) -> None:
    new_order(client, cashier)  # CKL 5 kg = 1 load cuci + 1 load kering
    queue = client.get("/orders/queue", headers=cashier).json()
    assert queue[0]["processing_hours"] == 2

    client.put(
        "/settings", json={"wash_minutes_per_load": 30, "dry_minutes_per_load": 45}, headers=owner
    )
    queue = client.get("/orders/queue", headers=cashier).json()
    assert queue[0]["processing_hours"] == 1.25


def test_staff_can_rename_themselves_only(client: TestClient, staff: dict, owner: dict) -> None:
    res = client.put("/auth/me", json={"name": "  Rina Sitompul  "}, headers=staff)
    assert res.status_code == 200, res.text
    me = res.json()
    assert me["name"] == "Rina Sitompul" and me["role"] == "staff"
    assert client.get("/auth/me", headers=staff).json()["name"] == "Rina Sitompul"
    assert client.put("/auth/me", json={"name": " "}, headers=staff).status_code == 422
    # Field lain diabaikan: role tetap urusan pemilik.
    client.put("/auth/me", json={"name": "Rina", "role": "owner"}, headers=staff)
    assert client.get("/auth/me", headers=staff).json()["role"] == "staff"

    log = client.get("/activity-logs", headers=owner).json()[0]
    assert log["action"] == "user.profile"


def test_daily_exception_can_be_removed(client: TestClient, owner: dict, cashier: dict) -> None:
    body = {
        "is_open": False,
        "staff_on_duty": 2,
        "washers_available": 4,
        "dryers_available": 3,
        "open_time": "08:00",
        "close_time": "17:00",
        "machine_issue_note": "Libur",
    }
    assert client.put("/daily-operations/2026-12-25", json=body, headers=owner).status_code == 200
    assert client.delete("/daily-operations/2026-12-25", headers=cashier).status_code == 403
    assert client.delete("/daily-operations/2026-12-25", headers=owner).status_code == 204
    assert client.delete("/daily-operations/2026-12-25", headers=owner).status_code == 404
    rows = client.get("/daily-operations", params={"days": 90}, headers=owner).json()
    assert all(r["date"] != "2026-12-25" for r in rows)
    log = client.get("/activity-logs", headers=owner).json()[0]
    assert log["action"] == "operation.delete"
