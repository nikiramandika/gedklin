import io
import json
import urllib.parse
from unittest.mock import patch

import pytest

from app.config import Settings
from app.services.notifications import ConsoleSender, FonnteSender, get_sender


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
