from fastapi.testclient import TestClient

from tests.conftest import new_order


def test_staff_queue_hides_price_payment_and_phone(
    client: TestClient, cashier: dict, staff: dict
) -> None:
    order = new_order(client, cashier, customer_name="Siti Aminah", notes="Jangan pakai pewangi")
    res = client.get("/work/queue", headers=staff)
    assert res.status_code == 200
    [row] = res.json()
    assert row["id"] == order["id"]
    assert row["customer_name"] == "Siti Aminah"
    assert row["queue_position"] == 1 and row["next_status"] == "PROCESSING"
    assert row["items"][0]["name"] == "Cuci + Kering + Lipat"
    text = res.text
    for hidden in ("price", "subtotal", "is_paid", "payment", "phone_wa", "6281234567890"):
        assert hidden not in text


def test_staff_moves_order_to_processing_and_ready(
    client: TestClient, cashier: dict, staff: dict
) -> None:
    order = new_order(client, cashier)
    path = f"/work/{order['id']}/status"

    res = client.post(path, json={"to_status": "PROCESSING"}, headers=staff)
    assert res.status_code == 200 and res.json()["status"] == "PROCESSING"

    res = client.post(path, json={"to_status": "READY", "rack_location": "b2"}, headers=staff)
    assert res.status_code == 200
    assert res.json()["status"] == "READY" and res.json()["rack_location"] == "B2"
    assert client.get("/work/queue", headers=staff).json() == []

    detail = client.get(f"/orders/{order['id']}", headers=cashier).json()
    assert detail["history"][-1]["changed_by_name"] == "Staff"


def test_staff_cannot_hand_over_or_use_counter(
    client: TestClient, cashier: dict, staff: dict
) -> None:
    order = new_order(client, cashier)
    path = f"/work/{order['id']}/status"
    assert client.post(path, json={"to_status": "PICKED_UP"}, headers=staff).status_code == 422
    assert client.post(path, json={"to_status": "READY"}, headers=staff).status_code == 409

    assert client.get("/orders/queue", headers=staff).status_code == 403
    assert client.get(f"/orders/{order['id']}", headers=staff).status_code == 403
    assert client.get("/customers", headers=staff).status_code == 403
    assert client.get("/work/queue", headers=cashier).status_code == 403


def test_owner_changes_staff_role_but_not_owner_role(client: TestClient, owner: dict) -> None:
    users = {u["username"]: u for u in client.get("/users", headers=owner).json()}

    res = client.patch(
        f"/users/{users['staff']['id']}",
        json={"role": "cashier", "name": "Rina"},
        headers=owner,
    )
    assert res.status_code == 200
    assert res.json()["role"] == "cashier" and res.json()["name"] == "Rina"

    res = client.patch(f"/users/{users['owner']['id']}", json={"role": "staff"}, headers=owner)
    assert res.status_code == 409

    res = client.patch(f"/users/{users['cashier']['id']}", json={"role": "owner"}, headers=owner)
    assert res.status_code == 422

    new = {"name": "Dedi", "username": "dedi", "password": "rahasia123", "role": "owner"}
    assert client.post("/users", json=new, headers=owner).status_code == 422
    new["role"] = "staff"
    assert client.post("/users", json=new, headers=owner).status_code == 201

    logs = client.get("/activity-logs", params={"entity_type": "user"}, headers=owner).json()
    assert any(e["changes"] and e["changes"].get("role") == ["staff", "cashier"] for e in logs)
