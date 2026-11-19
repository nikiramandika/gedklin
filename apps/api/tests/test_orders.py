from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import (
    Notification,
    NotificationStatus,
    NotificationType,
    Order,
    OrderStatus,
    PredictionLog,
)
from app.services.orders import OrderError, create_order, mark_followups, normalize_phone
from app.services.pricing import ItemRequest
from app.workers.tasks import send_notification
from tests.conftest import new_order


def advance(client: TestClient, headers: dict, order_id: int, *statuses: str) -> dict:
    body: dict = {}
    for s in statuses:
        body_in: dict = {"to_status": s}
        if s == "PICKED_UP":
            body_in["payment_method"] = "CASH"
        res = client.post(f"/orders/{order_id}/status", json=body_in, headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
    return body


def test_create_order_with_items_prices_and_promise(
    client: TestClient, cashier: dict, db: Session
) -> None:
    items = [
        {"catalog_code": "CKS", "weight_kg": 8},
        {"catalog_code": "KEMEJA_PANJANG", "qty_pcs": 2},
    ]
    order = new_order(client, cashier, items=items, is_express=True)
    # Express hanya untuk CKS: 55.000 x 2 + kemeja tetap Reguler 34.000.
    assert order["price_total"] == 144_000
    assert [
        (i["catalog_code"], i["machine_loads"], i["extra_kg"], i["is_express"])
        for i in order["items"]
    ] == [
        ("CKS", 1, 1, True),
        ("KEMEJA_PANJANG", None, None, False),
    ]
    assert order["customer"]["phone_wa"] == "6281234567890"
    assert len(order["tracking_code"]) == 10
    assert order["next_status"] == "PROCESSING"
    assert order["promised_ready_at"] is not None
    assert order["predicted_ready_at"] == order["promised_ready_at"]

    log = db.scalar(select(PredictionLog).where(PredictionLog.order_id == order["id"]))
    assert log is not None and log.model_version == "janji-mitra"
    assert log.features_json["max_process_level"] == 4
    assert log.features_json["n_satuan_items"] == 2
    assert "phone" not in str(log.features_json)


def test_quote_endpoint_and_validation(client: TestClient, cashier: dict) -> None:
    body: dict = {"is_express": False, "items": [{"catalog_code": "SETRIKA", "weight_kg": 3}]}
    res = client.post("/orders/quote", json=body, headers=cashier)
    assert res.status_code == 200, res.text
    assert res.json()["total"] == 25_000  # minimal 5 kg

    express_ck = {"is_express": True, "items": [{"catalog_code": "CK", "weight_kg": 5}]}
    res = client.post("/orders/quote", json=express_ck, headers=cashier)
    assert res.status_code == 422 and "Express hanya" in res.json()["detail"]

    body["items"] = [{"catalog_code": "CKS"}]
    res = client.post("/orders/quote", json=body, headers=cashier)
    assert res.status_code == 422 and "berat" in res.json()["detail"]
    order = {**body, "customer_name": "A", "customer_phone": "081234567890"}
    assert client.post("/orders", json=order, headers=cashier).status_code == 422


def test_promise_after_closing_moves_to_next_opening(db: Session) -> None:
    # Selasa 18.00 WIB + CKL 2 hari = Kamis 18.00, lewat jam tutup -> Jumat 08.00 WIB.
    order = create_order(
        db,
        customer_name="Budi",
        customer_phone="081234567890",
        is_express=False,
        items=[ItemRequest("CKL", weight_kg=5)],
        user=None,
        now=datetime(2026, 10, 20, 11, 0, tzinfo=UTC),
    )
    assert order.promised_ready_at == datetime(2026, 10, 23, 1, 0, tzinfo=UTC)


def test_flow_and_ready_notification_sent_once(
    client: TestClient, cashier: dict, db: Session
) -> None:
    order = new_order(client, cashier)
    res = client.post(f"/orders/{order['id']}/status", json={"to_status": "READY"}, headers=cashier)
    assert res.status_code == 409

    body = advance(client, cashier, order["id"], "PROCESSING")
    assert body["next_status"] == "READY"
    body = advance(client, cashier, order["id"], "READY")
    assert body["ready_at"] is not None
    assert body["ready_notif_sent"] is True

    notifs = list(
        db.scalars(
            select(Notification)
            .where(Notification.order_id == order["id"])
            .order_by(Notification.id)
        )
    )
    assert [(n.type, n.status) for n in notifs] == [
        (NotificationType.RECEIPT, NotificationStatus.SENT),
        (NotificationType.READY, NotificationStatus.SENT),
    ]

    assert send_notification.apply(args=[notifs[1].id]).get() == "already-sent"

    db.add(Notification(order_id=order["id"], type=NotificationType.READY))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    body = advance(client, cashier, order["id"], "PICKED_UP")
    assert body["picked_up_at"] is not None and body["next_status"] is None


def test_queue_is_express_first_then_fifo(client: TestClient, cashier: dict) -> None:
    a = new_order(client, cashier, customer_phone="081111111111")
    b = new_order(client, cashier, customer_phone="082222222222", is_express=True)
    c = new_order(client, cashier, customer_phone="083333333333")
    d = new_order(client, cashier, customer_phone="084444444444", is_express=True)
    queue = client.get("/orders/queue", headers=cashier).json()
    assert [o["id"] for o in queue] == [b["id"], d["id"], a["id"], c["id"]]
    assert [o["queue_position"] for o in queue] == [1, 2, 3, 4]


def test_receipt_sent_automatically_once_on_create(
    client: TestClient, cashier: dict, db: Session
) -> None:
    order = new_order(client, cashier)

    notifs = list(db.scalars(select(Notification).where(Notification.order_id == order["id"])))
    assert [(n.type, n.status) for n in notifs] == [
        (NotificationType.RECEIPT, NotificationStatus.SENT)
    ]
    assert notifs[0].provider_msg_id

    db.add(Notification(order_id=order["id"], type=NotificationType.RECEIPT))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


class QueueAwarePredictor:
    model_version = "uji-antrean"

    def predict_work_hours(self, features: dict[str, float]) -> tuple[float, str]:
        return 2 + 10 * features["active_orders_count"], self.model_version


def _create(db: Session, phone: str, at: datetime, *, express: bool = False) -> Order:
    return create_order(
        db,
        customer_name="Budi",
        customer_phone=phone,
        is_express=express,
        items=[ItemRequest("CKL", weight_kg=5)],
        user=None,
        now=at,
    )


# Selasa 20/10/2026 09.00 WIB.
MORNING = datetime(2026, 10, 20, 2, 0, tzinfo=UTC)


def test_delay_notification_when_express_cuts_in_regular_only_and_max_two(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.services.orders.get_predictor", lambda: QueueAwarePredictor())
    regular = _create(db, "081111111111", MORNING)
    first_eta = regular.predicted_ready_at
    for i in range(3):
        _create(db, f"08222222222{i}", MORNING + timedelta(minutes=10 * (i + 1)), express=True)

    db.expire_all()
    reg = db.get(Order, regular.id)
    assert reg.predicted_ready_at > first_eta
    assert reg.initial_predicted_ready_at == first_eta
    assert reg.delay_notif_count == 2
    delays = list(
        db.scalars(select(Notification).where(Notification.type == NotificationType.DELAY))
    )
    assert [n.order_id for n in delays] == [regular.id, regular.id]
    assert all(n.status == NotificationStatus.SENT for n in delays)


def test_model_switch_does_not_send_delay_whatsapp(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.orders import recompute_etas

    regular = _create(db, "081111111111", MORNING)
    _create(db, "082222222222", MORNING + timedelta(minutes=5))

    class SlowModel(QueueAwarePredictor):
        model_version = "model-baru"

        def predict_work_hours(self, features: dict[str, float]) -> tuple[float, str]:
            return 40.0, self.model_version

    monkeypatch.setattr("app.services.orders.get_predictor", lambda: SlowModel())
    recompute_etas(db, MORNING + timedelta(hours=1))

    db.expire_all()
    reg = db.get(Order, regular.id)
    assert reg.predicted_ready_at > reg.promised_ready_at + timedelta(hours=6)
    assert reg.last_notified_eta == reg.predicted_ready_at
    assert reg.delay_notif_count == 0
    assert (
        db.scalar(select(Notification).where(Notification.type == NotificationType.DELAY)) is None
    )


def test_overdue_eta_is_not_moved_by_clicks(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.orders import change_status

    monkeypatch.setattr("app.services.orders.get_predictor", lambda: QueueAwarePredictor())
    late = _create(db, "081111111111", MORNING)
    eta = late.predicted_ready_at
    later = MORNING + timedelta(days=3)

    _create(db, "082222222222", later)
    change_status(db, late, OrderStatus.PROCESSING, None, later + timedelta(minutes=5))

    db.expire_all()
    late = db.get(Order, late.id)
    assert late.predicted_ready_at == eta
    assert late.promised_ready_at < later
    assert late.delay_notif_count == 0


def test_started_order_goes_ahead_and_pushes_waiting_eta(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.orders import change_status

    monkeypatch.setattr("app.services.orders.get_predictor", lambda: QueueAwarePredictor())
    first = _create(db, "081111111111", MORNING)
    second = _create(db, "082222222222", MORNING + timedelta(minutes=5))
    eta = first.predicted_ready_at

    change_status(db, second, OrderStatus.PROCESSING, None, MORNING + timedelta(minutes=10))

    db.expire_all()
    assert db.get(Order, first.id).predicted_ready_at > eta


def test_model_eta_counts_only_open_hours(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    # Diterima Selasa 16.00 WIB, model 2 jam kerja -> Rabu 09.00 WIB (bukan 08.00).
    monkeypatch.setattr("app.services.orders.get_predictor", lambda: QueueAwarePredictor())
    order = _create(db, "081111111111", datetime(2026, 10, 20, 9, 0, tzinfo=UTC))
    assert order.predicted_ready_at == datetime(2026, 10, 21, 2, 0, tzinfo=UTC)


def test_small_eta_changes_do_not_notify(client: TestClient, cashier: dict, db: Session) -> None:
    from app.services.orders import recompute_etas

    order = new_order(client, cashier)
    recompute_etas(db)
    db.expire_all()
    assert db.get(Order, order["id"]).delay_notif_count == 0


def test_followup_marked_after_three_days_without_whatsapp(
    client: TestClient, cashier: dict, admin: dict, db: Session
) -> None:
    order = new_order(client, cashier)
    advance(client, cashier, order["id"], "PROCESSING", "READY")

    assert mark_followups(db, utcnow() + timedelta(days=2)) == 0
    assert mark_followups(db, utcnow() + timedelta(days=4)) == 1

    followups = client.get("/admin/followups", headers=admin).json()
    assert [o["id"] for o in followups] == [order["id"]]
    types = set(db.scalars(select(Notification.type).where(Notification.order_id == order["id"])))
    assert types == {NotificationType.RECEIPT, NotificationType.READY}

    advance(client, cashier, order["id"], "PICKED_UP")
    assert client.get("/admin/followups", headers=admin).json() == []


def test_public_tracking_has_no_personal_data(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier, customer_name="Siti Aminah")
    res = client.get(f"/public/track/{order['tracking_code'].lower()}")
    assert res.status_code == 200
    text = res.text
    assert "Siti" not in text and "6281234567890" not in text
    assert "customer" not in res.json() and "price_total" not in res.json()
    assert res.json()["history"][0]["to_status"] == OrderStatus.RECEIVED.value
    assert res.json()["items"] == [
        {"name": "Cuci + Kering + Lipat", "weight_kg": 5.0, "qty_pcs": None}
    ]

    assert client.get("/public/track/TIDAKADA00").status_code == 404


def test_role_access(client: TestClient, cashier: dict, admin: dict, owner: dict) -> None:
    assert client.get("/dashboard/summary", headers=cashier).status_code == 403
    assert client.get("/dashboard/summary", headers=owner).status_code == 200
    assert client.get("/settings", headers=cashier).status_code == 403
    assert client.post("/orders", json={}, headers=admin).status_code == 403
    assert client.get("/admin/followups", headers=cashier).status_code == 403
    assert client.get("/orders/queue").status_code == 401


def test_receipt_contains_whatsapp_link(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier)
    res = client.get(f"/orders/{order['id']}/receipt", headers=cashier).json()
    assert res["whatsapp_link"].startswith("https://wa.me/6281234567890?text=")
    assert "Cuci + Kering + Lipat 5 kg: Rp25.000" in res["message"]
    assert "Total: Rp25.000" in res["message"]
    assert order["tracking_code"] in res["tracking_url"]


def test_owner_changes_price_and_express_multiplier(
    client: TestClient, owner: dict, cashier: dict
) -> None:
    body = {"is_express": True, "items": [{"catalog_code": "CKL", "weight_kg": 5}]}
    assert client.post("/orders/quote", json=body, headers=cashier).json()["total"] == 50_000

    res = client.put("/settings", json={"express_multiplier": 1.5}, headers=owner)
    assert res.status_code == 200 and res.json()["express_multiplier"] == 1.5
    res = client.put("/catalog/CKL", json={"price": 30_000}, headers=owner)
    assert res.status_code == 200
    assert client.post("/orders/quote", json=body, headers=cashier).json()["total"] == 45_000

    assert client.put("/catalog/CKL", json={"price": 1}, headers=cashier).status_code == 403

    res = client.put("/catalog/DC_SONGKET", json={"is_active": True}, headers=owner)
    assert res.status_code == 422
    res = client.put(
        "/catalog/DC_SONGKET", json={"price": 50_000, "is_active": True}, headers=owner
    )
    assert res.status_code == 200 and res.json()["is_active"] is True
    client.put("/catalog/CKL", json={"is_active": False}, headers=owner)
    codes = [c["code"] for c in client.get("/catalog", headers=cashier).json()]
    assert "CKL" not in codes and "CKS" in codes


def test_daily_operations_capacity_and_promises(client: TestClient, owner: dict) -> None:
    body = {
        "is_open": True,
        "staff_on_duty": 1,
        "washers_available": 3,
        "dryers_available": 2,
        "open_time": "08:00",
        "close_time": "17:00",
        "machine_issue_note": "1 mesin cuci rusak",
    }
    res = client.put("/daily-operations/2026-10-20", json=body, headers=owner)
    assert res.status_code == 200, res.text
    assert res.json()["washers_available"] == 3

    promises = client.get("/service-promises", headers=owner).json()
    by_process = {p["process"]: p for p in promises}
    assert by_process["CKS"]["regular_hours"] == 96
    assert by_process["CKS"]["min_regular_hours"] == 72
    assert by_process["CK"]["regular_hours"] is None
    assert {p for p, v in by_process.items() if v["express_hours"] == 24} == {"CKL", "CKS"}
    assert "DRY_CLEAN" in by_process

    res = client.put(
        "/service-promises/CK", json={"regular_hours": 36, "express_hours": 24}, headers=owner
    )
    assert res.status_code == 200 and res.json()["regular_hours"] == 36


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0812-3456-7890", "6281234567890"),
        ("+62 812-3456-789", "628123456789"),
        ("(0812) 3456 7890", "6281234567890"),
        ("812345678", "62812345678"),
    ],
)
def test_normalize_phone_accepts_mobile_numbers(raw: str, expected: str) -> None:
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "08abc123def4567",
        "021 5551234",
        "0812",
        "0899 9999 9999 99",
        "+1 415 555 0100",
        "0812-3456-7890 ext",
    ],
)
def test_normalize_phone_rejects_junk(raw: str) -> None:
    with pytest.raises(OrderError):
        normalize_phone(raw)


def test_create_order_rejects_invalid_phone(client: TestClient, cashier: dict) -> None:
    payload = {
        "customer_name": "Budi",
        "customer_phone": "08abc123def4567",
        "is_express": False,
        "items": [{"catalog_code": "CKL", "weight_kg": 5}],
    }
    res = client.post("/orders", json=payload, headers=cashier)
    assert res.status_code == 422 and "Nomor WhatsApp" in res.json()["detail"]


def test_customer_without_whatsapp_gets_no_wa_and_may_use_landline(
    client: TestClient, cashier: dict, db: Session
) -> None:
    order = new_order(
        client, cashier, customer_phone="021-555-1234", customer_has_whatsapp=False
    )
    assert order["customer"]["has_whatsapp"] is False
    assert order["customer"]["phone_wa"] == "62215551234"
    advance(client, cashier, order["id"], "PROCESSING", "READY")
    notifs = db.scalars(select(Notification).where(Notification.order_id == order["id"]))
    assert list(notifs) == []

    found = client.get("/orders/customers/lookup?phone=021 555 1234", headers=cashier).json()
    assert found["has_whatsapp"] is False


def test_landline_still_rejected_when_customer_uses_whatsapp(
    client: TestClient, cashier: dict
) -> None:
    payload = {
        "customer_name": "Budi",
        "customer_phone": "021-555-1234",
        "items": [{"catalog_code": "CKL", "weight_kg": 5}],
    }
    assert client.post("/orders", json=payload, headers=cashier).status_code == 422


def test_queued_notification_skipped_after_customer_drops_whatsapp(
    client: TestClient, cashier: dict, db: Session
) -> None:
    order = new_order(client, cashier)
    res = client.patch(
        f"/customers/{order['customer']['id']}", json={"has_whatsapp": False}, headers=cashier
    )
    assert res.status_code == 200 and res.json()["has_whatsapp"] is False
    notif = Notification(order_id=order["id"], type=NotificationType.READY)
    db.add(notif)
    db.commit()
    assert send_notification.apply(args=[notif.id]).get() == "no-whatsapp"


def test_turning_whatsapp_on_requires_mobile_number(client: TestClient, cashier: dict) -> None:
    order = new_order(
        client, cashier, customer_phone="021-555-1234", customer_has_whatsapp=False
    )
    res = client.patch(
        f"/customers/{order['customer']['id']}", json={"has_whatsapp": True}, headers=cashier
    )
    assert res.status_code == 422
