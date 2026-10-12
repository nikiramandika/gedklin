from datetime import timedelta

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
from app.services.orders import mark_followups
from app.workers.tasks import send_notification
from tests.conftest import new_order


def advance(client: TestClient, headers: dict, order_id: int, *statuses: str) -> dict:
    body: dict = {}
    for s in statuses:
        res = client.post(f"/orders/{order_id}/status", json={"to_status": s}, headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
    return body


def test_create_order_sets_price_eta_and_logs_prediction(
    client: TestClient, cashier: dict, db: Session
) -> None:
    order = new_order(client, cashier, weight_kg=3.5, is_express=True)
    assert order["price_total"] == "35000.00"
    assert order["customer"]["phone_wa"] == "6281234567890"
    assert len(order["tracking_code"]) == 10
    assert order["predicted_ready_at"] is not None
    assert order["next_status"] == "WASHING"

    log = db.scalar(select(PredictionLog).where(PredictionLog.order_id == order["id"]))
    assert log is not None and log.model_version == "baseline-median"
    assert "phone" not in str(log.features_json)


def test_ck_flow_skips_ironing_and_sends_ready_once(
    client: TestClient, cashier: dict, db: Session
) -> None:
    order = new_order(client, cashier, service_type="CK")
    res = client.post(
        f"/orders/{order['id']}/status", json={"to_status": "DRYING"}, headers=cashier
    )
    assert res.status_code == 409

    body = advance(client, cashier, order["id"], "WASHING", "DRYING")
    assert body["next_status"] == "READY"
    body = advance(client, cashier, order["id"], "READY")
    assert body["ready_at"] is not None
    assert body["ready_notif_sent"] is True

    notifs = list(db.scalars(select(Notification).where(Notification.order_id == order["id"])))
    assert [(n.type, n.status) for n in notifs] == [
        (NotificationType.READY, NotificationStatus.SENT)
    ]

    # Menjalankan ulang task tidak mengirim dua kali.
    assert send_notification.apply(args=[notifs[0].id]).get() == "already-sent"

    # Unique index mencegah baris READY kedua.
    db.add(Notification(order_id=order["id"], type=NotificationType.READY))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    body = advance(client, cashier, order["id"], "PICKED_UP")
    assert body["picked_up_at"] is not None and body["next_status"] is None


def test_cks_flow_requires_ironing(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier, service_type="CKS")
    body = advance(client, cashier, order["id"], "WASHING", "DRYING")
    assert body["next_status"] == "IRONING"
    advance(client, cashier, order["id"], "IRONING", "READY")


def test_queue_is_express_first_then_fifo(client: TestClient, cashier: dict) -> None:
    a = new_order(client, cashier, customer_phone="081111111111")
    b = new_order(client, cashier, customer_phone="082222222222", is_express=True)
    c = new_order(client, cashier, customer_phone="083333333333")
    d = new_order(client, cashier, customer_phone="084444444444", is_express=True)
    queue = client.get("/orders/queue", headers=cashier).json()
    assert [o["id"] for o in queue] == [b["id"], d["id"], a["id"], c["id"]]
    assert [o["queue_position"] for o in queue] == [1, 2, 3, 4]


def test_delay_notification_regular_only_and_max_two(
    client: TestClient, cashier: dict, db: Session
) -> None:
    from app.services.orders import recompute_etas

    regular = new_order(client, cashier, customer_phone="081111111111")
    express = new_order(client, cashier, customer_phone="082222222222", is_express=True)

    now = utcnow()
    for hours in (60, 120, 180):
        recompute_etas(db, now + timedelta(hours=hours))

    db.expire_all()
    reg = db.get(Order, regular["id"])
    exp = db.get(Order, express["id"])
    assert reg.delay_notif_count == 2
    assert exp.delay_notif_count == 0
    delays = list(
        db.scalars(
            select(Notification).where(
                Notification.order_id == regular["id"], Notification.type == NotificationType.DELAY
            )
        )
    )
    assert len(delays) == 2 and all(n.status == NotificationStatus.SENT for n in delays)


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
    advance(client, cashier, order["id"], "WASHING", "DRYING", "READY")

    assert mark_followups(db, utcnow() + timedelta(days=2)) == 0
    assert mark_followups(db, utcnow() + timedelta(days=4)) == 1

    followups = client.get("/admin/followups", headers=admin).json()
    assert [o["id"] for o in followups] == [order["id"]]
    count = len(list(db.scalars(select(Notification).where(Notification.order_id == order["id"]))))
    assert count == 1  # hanya notifikasi READY

    advance(client, cashier, order["id"], "PICKED_UP")
    assert client.get("/admin/followups", headers=admin).json() == []


def test_public_tracking_has_no_personal_data(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier, customer_name="Siti Aminah")
    res = client.get(f"/public/track/{order['tracking_code'].lower()}")
    assert res.status_code == 200
    text = res.text
    assert "Siti" not in text and "6281234567890" not in text
    assert "customer" not in res.json()
    assert res.json()["history"][0]["to_status"] == OrderStatus.RECEIVED.value

    assert client.get("/public/track/TIDAKADA00").status_code == 404


def test_role_access(client: TestClient, cashier: dict, admin: dict, owner: dict) -> None:
    assert client.get("/dashboard/summary", headers=cashier).status_code == 403
    assert client.get("/dashboard/summary", headers=owner).status_code == 200
    assert client.post("/orders", json={}, headers=admin).status_code == 403
    assert client.get("/admin/followups", headers=cashier).status_code == 403
    assert client.get("/orders/queue").status_code == 401


def test_receipt_contains_whatsapp_link(client: TestClient, cashier: dict) -> None:
    order = new_order(client, cashier, weight_kg=2)
    res = client.get(f"/orders/{order['id']}/receipt", headers=cashier).json()
    assert res["whatsapp_link"].startswith("https://wa.me/6281234567890?text=")
    assert "Rp12.000" in res["message"]
    assert order["tracking_code"] in res["tracking_url"]
