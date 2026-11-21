from fastapi.testclient import TestClient

from app.routers.tracking import mask_name
from tests.conftest import new_order


def logs(client: TestClient, owner: dict, **params: object) -> list[dict]:
    res = client.get("/activity-logs", params=params, headers=owner)
    assert res.status_code == 200, res.text
    return res.json()


def test_order_shows_who_received_and_changed_status(
    client: TestClient, cashier: dict, owner: dict
) -> None:
    order = new_order(client, cashier)
    assert order["created_by_name"] == "Cashier"
    client.post(f"/orders/{order['id']}/status", json={"to_status": "PROCESSING"}, headers=owner)

    detail = client.get(f"/orders/{order['id']}", headers=cashier).json()
    assert [(h["to_status"], h["changed_by_name"]) for h in detail["history"]] == [
        ("RECEIVED", "Cashier"),
        ("PROCESSING", "Owner"),
    ]

    entries = logs(client, owner, entity_type="order")
    assert [e["action"] for e in entries] == ["order.status", "order.create"]
    assert entries[0]["user_name"] == "Owner"
    assert entries[0]["changes"] == {"status": ["Diterima", "Diproses"]}
    assert order["tracking_code"] in entries[1]["summary"]


def test_public_tracking_hides_staff_names(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier)
    res = client.get(f"/public/track/{order['tracking_code']}")
    assert "Cashier" not in res.text and "changed_by" not in res.text


def test_owner_changes_are_logged_with_before_and_after(
    client: TestClient, owner: dict, cashier: dict
) -> None:
    client.put("/catalog/CKS", json={"price": 50_000}, headers=owner)
    client.put("/catalog/CKS", json={"is_active": False}, headers=owner)
    client.put("/settings", json={"express_multiplier": 1.5}, headers=owner)
    users = client.get("/users", headers=owner).json()
    kasir = next(u for u in users if u["username"] == "cashier")
    client.patch(f"/users/{kasir['id']}", json={"password": "rahasiabaru1"}, headers=owner)

    entries = logs(client, owner)
    by_action = {e["action"]: e for e in entries}
    assert by_action["user.password"]["changes"] is None
    assert "rahasiabaru1" not in str(entries)
    assert by_action["settings.update"]["changes"] == {"express_multiplier": [2.0, 1.5]}

    catalog = logs(client, owner, entity_type="catalog")
    assert [e["summary"] for e in catalog] == [
        "Menonaktifkan layanan Cuci + Kering + Setrika",
        "Mengubah layanan Cuci + Kering + Setrika",
    ]
    assert catalog[1]["changes"] == {"price": [45_000, 50_000]}

    client.put("/catalog/CKS", json={"is_active": False}, headers=owner)
    assert len(logs(client, owner, entity_type="catalog")) == 2


def test_logins_logged_and_paging_and_owner_only(
    client: TestClient, owner: dict, cashier: dict, staff: dict
) -> None:
    entries = logs(client, owner, entity_type="auth")
    assert {e["user_name"] for e in entries} == {"Owner", "Cashier", "Staff"}

    first = logs(client, owner, limit=1)
    rest = logs(client, owner, before_id=first[0]["id"])
    assert all(e["id"] < first[0]["id"] for e in rest)

    assert client.get("/activity-logs", headers=cashier).status_code == 403
    assert client.get("/activity-logs", headers=staff).status_code == 403


def test_search_by_tracking_code_shows_whole_order_trail(
    client: TestClient, cashier: dict, owner: dict
) -> None:
    order = new_order(client, cashier, customer_name="Siti Aminah")
    other = new_order(client, cashier, customer_phone="082222222222")
    for status in ("PROCESSING", "READY", "PICKED_UP"):
        body = {"to_status": status, "payment_method": "QRIS"}
        res = client.post(f"/orders/{order['id']}/status", json=body, headers=cashier)
        assert res.status_code == 200, res.text

    code = order["tracking_code"]
    trail = logs(client, owner, q=f" {code.lower()} ")
    assert [e["action"] for e in trail] == [
        "order.status",
        "order.payment",
        "order.status",
        "order.status",
        "order.create",
    ]
    assert all(e["entity_id"] == code for e in trail)
    assert other["tracking_code"] not in str(trail)

    assert len(logs(client, owner, q="siti")) == 5
    assert logs(client, owner, q="TIDAKADA00") == []


def test_public_tracking_shows_masked_name_total_and_hours(
    client: TestClient, cashier: dict
) -> None:
    order = new_order(client, cashier, customer_name="Niki Ramandika", customer_has_whatsapp=False)
    body = client.get(f"/public/track/{order['tracking_code']}").json()
    assert body["customer_name"] == "Ni** R."
    assert "Ramandika" not in str(body) and "62812" not in str(body)
    assert body["whatsapp_updates"] is False
    assert body["price_total"] == order["price_total"] and body["is_paid"] is False
    assert set(body["outlet_today"]) == {"is_open", "open_time", "close_time"}


def test_mask_name_short_and_single_word() -> None:
    assert mask_name("Lia") == "Li*"
    assert mask_name("Budi") == "Bu**"
    assert mask_name("Christopher Nolan Jr") == "Ch*** J."
    assert mask_name("A") == "A"
