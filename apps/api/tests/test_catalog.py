from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ServiceCatalog
from app.seed import seed_reference_data
from tests.conftest import new_order

KILOAN = {
    "code": "CKS_PREMIUM",
    "name": "Cuci + Kering + Setrika Premium",
    "group": "KILOAN",
    "process": "CKS",
    "unit": "KILOAN_7KG",
    "price": 60_000,
    "extra_price": 12_000,
    "express_eligible": True,
}


def quote(client: TestClient, headers: dict, items: list[dict], express: bool = False) -> int:
    res = client.post(
        "/orders/quote", json={"is_express": express, "items": items}, headers=headers
    )
    assert res.status_code == 200, res.text
    return res.json()["total"]


def test_owner_creates_service_used_by_cashier(
    client: TestClient, owner: dict, cashier: dict
) -> None:
    res = client.post("/catalog", json=KILOAN, headers=owner)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["base_kg"] == 7 and body["kg_per_load"] is None
    assert body["sort_order"] > 0

    item = [{"catalog_code": "CKS_PREMIUM", "weight_kg": 9}]
    assert quote(client, cashier, item) == 60_000 + 2 * 12_000
    assert quote(client, cashier, item, express=True) == 2 * (60_000 + 2 * 12_000)

    assert client.post("/catalog", json=KILOAN, headers=owner).status_code == 409
    assert client.post("/catalog", json=KILOAN, headers=cashier).status_code == 403


def test_create_rejects_invalid_combinations(client: TestClient, owner: dict) -> None:
    cases = [
        ({**KILOAN, "code": "X1", "process": "S"}, "Proses"),
        ({**KILOAN, "code": "X2", "unit": "PCS"}, "Satuan"),
        ({**KILOAN, "code": "X3", "price": None}, "harga"),
        (
            {
                "code": "X4",
                "name": "Bed cover",
                "group": "KHUSUS",
                "process": "CKL",
                "unit": "PCS",
                "price": 30_000,
                "express_eligible": True,
            },
            "Express",
        ),
        (
            {
                "code": "X5",
                "name": "Selimut",
                "group": "KHUSUS",
                "process": "CKL",
                "unit": "LOAD",
                "price": 25_000,
            },
            "kapasitas",
        ),
    ]
    for payload, message in cases:
        res = client.post("/catalog", json=payload, headers=owner)
        assert res.status_code == 422, payload
        assert message in str(res.json()["detail"]), res.json()

    res = client.post("/catalog", json={**KILOAN, "code": "huruf kecil"}, headers=owner)
    assert res.status_code == 422


def test_owner_edits_all_fields(client: TestClient, owner: dict, cashier: dict) -> None:
    body = {
        "unit": "LOAD",
        "pcs_per_load": 3,
        "extra_price": 6_000,
        "max_extra": 2,
        "price": 28_000,
    }
    res = client.put("/catalog/BEDCOVER_K", json=body, headers=owner)
    assert res.status_code == 200, res.text
    assert res.json()["unit"] == "LOAD"
    assert quote(client, cashier, [{"catalog_code": "BEDCOVER_K", "qty_pcs": 5}]) == 28_000 + 12_000

    res = client.put("/catalog/BEDCOVER_K", json={"group": "SATUAN"}, headers=owner)
    assert res.status_code == 422
    assert (
        client.put("/catalog/BEDCOVER_K", json={"code": "LAIN"}, headers=owner).status_code == 200
    )
    codes = {c["code"] for c in client.get("/catalog", headers=owner).json()}
    assert "BEDCOVER_K" in codes and "LAIN" not in codes


def test_delete_only_unused_services(
    client: TestClient, owner: dict, cashier: dict, db: Session
) -> None:
    assert client.delete("/catalog/KHIMAR_XL", headers=cashier).status_code == 403
    assert client.delete("/catalog/KHIMAR_XL", headers=owner).status_code == 204
    assert client.delete("/catalog/KHIMAR_XL", headers=owner).status_code == 404

    new_order(client, cashier)
    res = client.delete("/catalog/CKL", headers=owner)
    assert res.status_code == 409 and "Nonaktifkan" in res.json()["detail"]

    seed_reference_data(db)
    db.commit()
    assert db.scalar(select(ServiceCatalog).where(ServiceCatalog.code == "KHIMAR_XL")) is None


def test_work_minutes_from_catalog_feed_the_queue(
    client: TestClient, owner: dict, cashier: dict
) -> None:
    body = {"work_minutes": 90, "work_per_order": False}
    res = client.put("/catalog/BEDCOVER_K", json=body, headers=owner)
    assert res.status_code == 200, res.text
    assert res.json()["work_minutes"] == 90
    assert (
        client.put("/catalog/BEDCOVER_K", json={"work_minutes": 0}, headers=owner).status_code
        == 422
    )

    new_order(client, cashier, items=[{"catalog_code": "BEDCOVER_K", "qty_pcs": 2}])
    (entry,) = client.get("/orders/queue", headers=cashier).json()
    # 2 pcs x 90 menit, dipakai apa adanya.
    assert entry["processing_hours"] == 3

    # Per pesanan: 90 menit sekali, berapa pun jumlahnya.
    client.put("/catalog/BEDCOVER_K", json={"work_per_order": True}, headers=owner)
    (entry,) = client.get("/orders/queue", headers=cashier).json()
    assert entry["processing_hours"] == 1.5
    assert entry["est_ready_at"] is not None and entry["est_staff"] == 2

    # Dikosongkan lagi: kembali ke hitungan mesin (bed cover per pcs tidak punya load).
    client.put("/catalog/BEDCOVER_K", json={"work_minutes": None}, headers=owner)
    (entry,) = client.get("/orders/queue", headers=cashier).json()
    assert entry["processing_hours"] == 0


def test_promise_is_set_per_service(client: TestClient, owner: dict, cashier: dict) -> None:
    res = client.put("/catalog/BONEKA_L", json={"promise_hours": 120}, headers=owner)
    assert res.status_code == 200, res.text
    boneka = new_order(client, cashier, items=[{"catalog_code": "BONEKA_L", "qty_pcs": 1}])
    kemeja = new_order(
        client,
        cashier,
        customer_phone="081111111111",
        items=[{"catalog_code": "KEMEJA_PENDEK", "qty_pcs": 1}],
    )
    assert boneka["promised_ready_at"] != kemeja["promised_ready_at"]

    # Janji Express lebih lama dari Reguler ditolak.
    body = {"promise_hours": 24, "express_promise_hours": 48}
    assert client.put("/catalog/CKL", json=body, headers=owner).status_code == 422
