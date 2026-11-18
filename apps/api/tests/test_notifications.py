import io
import json
import urllib.parse
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Notification, NotificationStatus
from app.services.notifications import (
    ConsoleSender,
    FonnteSender,
    OpenWASender,
    SendDeferred,
    get_sender,
)
from app.workers import tasks
from tests.conftest import new_order


class FakeResponse(io.BytesIO):
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def fake_urlopen(payload: dict, captured: dict):
    def _open(request, timeout):  # noqa: ANN001, ANN202
        captured["request"] = request
        return FakeResponse(json.dumps(payload).encode())

    return _open


def test_fonnte_sends_form_with_token_and_normalized_target() -> None:
    captured: dict = {}
    ok = {"status": True, "id": ["80367170"], "detail": "success! message in queue"}
    with patch("urllib.request.urlopen", fake_urlopen(ok, captured)):
        msg_id = FonnteSender("tok123").send("+62 812-3456-789", "Halo")

    request = captured["request"]
    form = urllib.parse.parse_qs(request.data.decode())
    assert msg_id == "fonnte-80367170"
    assert request.full_url == FonnteSender.URL
    assert request.get_header("Authorization") == "tok123"
    assert form == {"target": ["628123456789"], "message": ["Halo"], "countryCode": ["62"]}


@pytest.mark.parametrize("key", ["status", "Status"])
def test_fonnte_failure_raises_with_reason(key: str) -> None:
    with patch("urllib.request.urlopen", fake_urlopen({key: False, "reason": "token invalid"}, {})):
        with pytest.raises(RuntimeError, match="token invalid"):
            FonnteSender("tok123").send("08123456789", "Halo")


def test_get_sender_picks_provider() -> None:
    assert isinstance(get_sender(Settings(wa_provider="console")), ConsoleSender)
    assert isinstance(get_sender(Settings(wa_provider="fonnte", wa_api_key="t")), FonnteSender)
    with pytest.raises(ValueError):
        get_sender(Settings(wa_provider="fonnte", wa_api_key=""))


def openwa_response(status: int, payload: object) -> httpx.Response:
    return httpx.Response(status, json=payload)


def test_openwa_sends_chat_id_with_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    def fake_post(url: str, json: dict, headers: dict, timeout: float) -> httpx.Response:
        captured.update(url=url, json=json, headers=headers)
        return openwa_response(201, {"messageId": "true_628123@c.us_3EB0", "timestamp": 1})

    monkeypatch.setattr(httpx, "post", fake_post)
    sender = OpenWASender("http://wa.local:2785/", "owa_k1_abc", "sess-1")
    assert sender.send("0812-3456-789", "Halo") == "openwa-true_628123@c.us_3EB0"
    assert captured["url"] == "http://wa.local:2785/api/sessions/sess-1/messages/send-text"
    assert captured["headers"] == {"X-API-Key": "owa_k1_abc"}
    assert captured["json"] == {"chatId": "628123456789@c.us", "text": "Halo"}


def test_openwa_pacing_limit_is_deferred_not_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"statusCode": 429, "code": "SEND_PACING_LIMITED", "retryAfterSeconds": 1800}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: openwa_response(429, body))
    with pytest.raises(SendDeferred) as info:
        OpenWASender("http://wa", "k", "s").send("628123456789", "Halo")
    assert info.value.retry_after == 1800


def test_openwa_error_message_is_readable(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"statusCode": 400, "message": ["number not registered"], "error": "Bad Request"}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: openwa_response(400, body))
    with pytest.raises(RuntimeError, match="400: number not registered"):
        OpenWASender("http://wa", "k", "s").send("628123456789", "Halo")


def test_get_sender_openwa_requires_session() -> None:
    sender = get_sender(Settings(wa_provider="openwa", wa_api_key="k", openwa_session_id="s"))
    assert isinstance(sender, OpenWASender)
    with pytest.raises(ValueError, match="OPENWA_SESSION_ID"):
        get_sender(Settings(wa_provider="openwa", wa_api_key="k", openwa_session_id=""))


def test_deferred_notification_retries_after_gateway_delay(
    client: TestClient, cashier: dict, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    order = new_order(client, cashier)
    notif = db.scalar(select(Notification).where(Notification.order_id == order["id"]))
    notif.status = NotificationStatus.PENDING
    db.commit()

    class Paced:
        def send(self, phone_wa: str, message: str) -> str:
            raise SendDeferred("Ditunda", 7200)

    retried: dict = {}

    def fake_retry(**kwargs: object) -> Exception:
        retried.update(kwargs)
        return RuntimeError("retry dijadwalkan")

    monkeypatch.setattr(tasks, "get_sender", lambda: Paced())
    monkeypatch.setattr(tasks.send_notification, "retry", fake_retry)
    tasks.send_notification.apply(args=[notif.id])

    assert retried["countdown"] == 55 * 60
    assert retried["max_retries"] == tasks.MAX_DEFERRALS
    db.refresh(notif)
    assert notif.status == NotificationStatus.FAILED and notif.error == "Ditunda"
