from datetime import datetime

from fastapi.testclient import TestClient

from gedklin_ml.features import LOCAL_TZ
from tests.conftest import PASSWORD, new_order


def status(client: TestClient, headers: dict, order_id: int, to: str, **extra: object):
    return client.post(
        f"/orders/{order_id}/status", json={"to_status": to, **extra}, headers=headers
    )


def test_pay_upfront_with_notes_shows_on_receipt(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier, notes="  Ada noda di kemeja putih ", payment_method="QRIS")
    assert order["notes"] == "Ada noda di kemeja putih"
    assert order["is_paid"] and order["payment_method"] == "QRIS" and order["paid_at"]

    message = client.get(f"/orders/{order['id']}/receipt", headers=cashier).json()["message"]
    assert "LUNAS" in message and "Catatan: Ada noda di kemeja putih" in message


def test_pickup_requires_payment(client: TestClient, cashier: dict, owner: dict) -> None:
    order = new_order(client, cashier)
    assert not order["is_paid"]
    status(client, cashier, order["id"], "PROCESSING")
    res = status(client, cashier, order["id"], "READY", rack_location=" b3 ")
    assert res.json()["rack_location"] == "B3"

    res = status(client, cashier, order["id"], "PICKED_UP")
    assert res.status_code == 409 and "belum lunas" in res.json()["detail"]

    res = status(client, cashier, order["id"], "PICKED_UP", payment_method="CASH")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "PICKED_UP" and body["is_paid"] and body["payment_method"] == "CASH"


def test_record_and_void_payment(client: TestClient, cashier: dict, owner: dict) -> None:
    order = new_order(client, cashier)
    path = f"/orders/{order['id']}/payment"
    assert client.post(path, json={"method": "TRANSFER"}, headers=cashier).json()["is_paid"]
    assert client.post(path, json={"method": "CASH"}, headers=cashier).status_code == 409

    assert client.delete(path, headers=cashier).status_code == 403
    res = client.delete(path, headers=owner)
    assert res.status_code == 200 and not res.json()["is_paid"]


def test_update_notes_and_rack(client: TestClient, cashier: dict, owner: dict) -> None:
    order = new_order(client, cashier)
    path = f"/orders/{order['id']}"
    res = client.patch(path, json={"notes": "Pisah warna", "rack_location": "a1"}, headers=cashier)
    assert (res.json()["notes"], res.json()["rack_location"]) == ("Pisah warna", "A1")
    res = client.patch(path, json={"rack_location": ""}, headers=cashier)
    assert res.json()["rack_location"] is None and res.json()["notes"] == "Pisah warna"

    logs = client.get("/activity-logs", params={"q": order["tracking_code"]}, headers=owner).json()
    assert [e["action"] for e in logs][:2] == ["order.update", "order.update"]


def test_correct_items_before_ready_and_unpaid(
    client: TestClient, cashier: dict, owner: dict
) -> None:
    order = new_order(client, cashier)  # CKL 5 kg = 25.000
    path = f"/orders/{order['id']}/items"
    body = {"is_express": False, "items": [{"catalog_code": "CKL", "weight_kg": 9}]}
    res = client.put(path, json=body, headers=cashier)
    assert res.status_code == 200, res.text
    fixed = res.json()
    assert fixed["price_total"] == 25_000 + 2 * 7_000
    assert [i["weight_kg"] for i in fixed["items"]] == [9]
    assert fixed["predicted_ready_at"] is not None

    entry = client.get(
        "/activity-logs", params={"q": order["tracking_code"]}, headers=owner
    ).json()[0]
    assert entry["action"] == "order.items" and entry["changes"]["total"] == [25_000, 39_000]

    client.post(f"/orders/{order['id']}/payment", json={"method": "CASH"}, headers=cashier)
    res = client.put(path, json=body, headers=cashier)
    assert res.status_code == 409 and "lunas" in res.json()["detail"]

    other = new_order(client, cashier, customer_phone="082222222222")
    status(client, cashier, other["id"], "PROCESSING")
    status(client, cashier, other["id"], "READY")
    res = client.put(f"/orders/{other['id']}/items", json=body, headers=cashier)
    assert res.status_code == 409


def test_cancel_order(client: TestClient, cashier: dict, owner: dict) -> None:
    order = new_order(client, cashier)
    path = f"/orders/{order['id']}/cancel"
    assert client.post(path, json={"reason": ""}, headers=cashier).status_code == 422
    res = client.post(path, json={"reason": "Pelanggan batal titip"}, headers=cashier)
    assert res.status_code == 200
    cancelled = res.json()
    assert cancelled["status"] == "CANCELLED" and cancelled["next_status"] is None
    assert cancelled["cancel_reason"] == "Pelanggan batal titip"

    queue = client.get("/orders/queue", headers=cashier).json()
    assert order["id"] not in [o["id"] for o in queue]
    assert status(client, cashier, order["id"], "PROCESSING").status_code == 409
    assert client.post(path, json={"reason": "lagi"}, headers=cashier).status_code == 409

    assert client.get("/dashboard/summary", headers=owner).json()["today_revenue"] == 0

    public = client.get(f"/public/track/{order['tracking_code']}")
    assert public.json()["status"] == "CANCELLED" and "titip" not in public.text


def test_paid_order_cannot_be_cancelled(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier, payment_method="CASH")
    res = client.post(f"/orders/{order['id']}/cancel", json={"reason": "salah"}, headers=cashier)
    assert res.status_code == 409


def test_customers_list_detail_and_update(client: TestClient, cashier: dict, owner: dict) -> None:
    a = new_order(client, cashier, customer_name="Siti", customer_phone="081111111111")
    new_order(
        client, cashier, customer_name="Siti", customer_phone="081111111111", payment_method="CASH"
    )
    new_order(client, cashier, customer_name="Budi", customer_phone="082222222222")

    rows = client.get("/customers", params={"q": "0811"}, headers=cashier).json()
    assert len(rows) == 1
    siti = rows[0]
    assert (siti["order_count"], siti["total_spent"], siti["unpaid_total"]) == (2, 50_000, 25_000)

    unpaid = client.get("/customers", params={"unpaid_only": True}, headers=cashier).json()
    assert {c["name"] for c in unpaid} == {"Siti", "Budi"}

    detail = client.get(f"/customers/{siti['id']}", headers=cashier).json()
    assert {o["id"] for o in detail["orders"]} >= {a["id"]}

    res = client.patch(
        f"/customers/{siti['id']}", json={"phone_wa": "0822-2222-2222"}, headers=cashier
    )
    assert res.status_code == 409
    res = client.patch(
        f"/customers/{siti['id']}",
        json={"name": "Siti Aminah", "phone_wa": "0813 3333 3333"},
        headers=cashier,
    )
    assert res.status_code == 200
    assert (res.json()["name"], res.json()["phone_wa"]) == ("Siti Aminah", "6281333333333")
    logs = client.get("/activity-logs", params={"entity_type": "customer"}, headers=owner).json()
    assert logs[0]["changes"]["no_wa"] == ["6281111111111", "6281333333333"]


def test_report_summary_and_csv(client: TestClient, cashier: dict, owner: dict) -> None:
    new_order(client, cashier, payment_method="QRIS")  # CKL 5 kg 25.000, lunas
    new_order(
        client,
        cashier,
        customer_phone="082222222222",
        items=[{"catalog_code": "CKS", "weight_kg": 8}],
    )  # 55.000, belum lunas
    batal = new_order(client, cashier, customer_phone="083333333333")
    client.post(f"/orders/{batal['id']}/cancel", json={"reason": "Batal"}, headers=cashier)

    today = datetime.now(LOCAL_TZ).date().isoformat()
    report = client.get(
        "/reports/summary", params={"start": today, "end": today}, headers=owner
    ).json()
    assert (report["orders"], report["revenue"], report["cancelled_orders"]) == (2, 80_000, 1)
    assert (report["paid_total"], report["unpaid_total"], report["unpaid_orders"]) == (
        25_000,
        55_000,
        1,
    )
    assert report["weight_kg"] == 13
    assert {r["key"]: r["revenue"] for r in report["by_service"]} == {"CKS": 55_000, "CKL": 25_000}
    assert {r["label"]: r["revenue"] for r in report["by_payment"]} == {
        "QRIS": 25_000,
        "Belum lunas": 55_000,
    }
    assert report["by_cashier"][0]["label"] == "Cashier"
    assert report["by_day"] == [{"date": today, "orders": 2, "revenue": 80_000}]

    res = client.get("/reports/orders.csv", params={"start": today, "end": today}, headers=owner)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    lines = res.text.lstrip("﻿").strip().splitlines()
    assert lines[0].startswith("Kode;Diterima;Kasir") and len(lines) == 4
    assert "Dibatalkan" in res.text and "Belum lunas" in res.text

    res_xlsx = client.get("/reports/orders.xlsx", params={"start": today, "end": today}, headers=owner)
    assert res_xlsx.status_code == 200 and "openxmlformats" in res_xlsx.headers["content-type"]
    assert len(res_xlsx.content) > 0

    assert client.get("/reports/summary", headers=cashier).status_code == 403
    bad = client.get(
        "/reports/summary", params={"start": today, "end": "2026-01-01"}, headers=owner
    )
    assert bad.status_code == 422


def test_login_lockout_after_five_failures(client: TestClient) -> None:
    def attempt(password: str) -> int:
        body = {"username": "cashier", "password": password}
        return client.post("/auth/login", json=body).status_code

    assert [attempt("salah") for _ in range(5)] == [401] * 5
    assert attempt(PASSWORD) == 429
    assert (
        client.post("/auth/login", json={"username": "staff", "password": PASSWORD}).status_code
        == 200
    )


def test_change_own_password(client: TestClient, cashier: dict) -> None:
    path = "/auth/change-password"
    bad = {"current_password": "salah", "new_password": "passwordbaru1"}
    assert client.post(path, json=bad, headers=cashier).status_code == 422
    same = {"current_password": PASSWORD, "new_password": PASSWORD}
    assert client.post(path, json=same, headers=cashier).status_code == 422
    ok = {"current_password": PASSWORD, "new_password": "passwordbaru1"}
    assert client.post(path, json=ok, headers=cashier).status_code == 204

    login = client.post("/auth/login", json={"username": "cashier", "password": "passwordbaru1"})
    assert login.status_code == 200
