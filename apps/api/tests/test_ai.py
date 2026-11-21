import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AppSetting
from app.services import ai
from tests.conftest import new_order

KEY = "sk-or-v1-abcdef1234567890"


def configure(client: TestClient, owner: dict, **body: object) -> dict:
    res = client.put(
        "/settings/ai", json={"provider": "openrouter", "api_key": KEY, **body}, headers=owner
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_key_is_encrypted_and_never_returned(client: TestClient, owner: dict, db: Session) -> None:
    out = configure(client, owner)
    assert out["has_key"] is True
    assert out["model"] == ai.PROVIDERS["openrouter"].default_model
    assert KEY not in str(out)
    assert out["key_hint"] == "sk-o…7890"

    stored = db.get(AppSetting, ai.KEY_API_KEY)
    assert stored is not None and KEY not in stored.value
    assert ai.load_ai_config(db).api_key == KEY

    # Key kosong = key lama dipertahankan; model bisa diganti.
    out = client.put(
        "/settings/ai", json={"provider": "openrouter", "model": "x/y"}, headers=owner
    ).json()
    assert out["has_key"] is True and out["model"] == "x/y"

    out = client.put(
        "/settings/ai", json={"provider": "gemini", "clear_key": True}, headers=owner
    ).json()
    assert out["has_key"] is False and out["model"] == ai.PROVIDERS["gemini"].default_model

    entries = client.get("/activity-logs", params={"entity_type": "settings"}, headers=owner).json()
    assert entries and all(KEY not in str(e) for e in entries)


def test_ai_settings_owner_only(client: TestClient, cashier: dict, staff: dict) -> None:
    for headers in (cashier, staff):
        assert client.get("/settings/ai", headers=headers).status_code == 403
        assert client.post("/reports/ai-analysis", json={}, headers=headers).status_code == 403


def test_analysis_requires_key(client: TestClient, owner: dict) -> None:
    res = client.post("/reports/ai-analysis", json={}, headers=owner)
    assert res.status_code == 400
    assert "API key" in res.json()["detail"]


def test_analysis_sends_aggregates_without_customer_data(
    client: TestClient, owner: dict, cashier: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    new_order(client, cashier, customer_name="Siti Rahma", customer_phone="0812-9999-1111")
    configure(client, owner)
    sent: dict = {}

    def fake_post(url: str, json: dict, headers: dict, timeout: float) -> httpx.Response:
        sent.update(url=url, json=json, headers=headers)
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "## Ringkasan\n- Ramai"}}]}
        )

    monkeypatch.setattr(ai.httpx, "post", fake_post)
    res = client.post(
        "/reports/ai-analysis", json={"question": "Layanan apa paling laku?"}, headers=owner
    )
    assert res.status_code == 201, res.text
    assert res.json()["text"] == "## Ringkasan\n- Ramai"
    assert res.json()["question"] == "Layanan apa paling laku?"
    assert res.json()["created_by_name"] == "Owner"

    assert sent["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert sent["headers"]["Authorization"] == f"Bearer {KEY}"
    prompt = sent["json"]["messages"][1]["content"]
    assert "Layanan apa paling laku?" in prompt
    assert '"pesanan": 1' in prompt
    assert "Siti" not in prompt and "9999" not in prompt


@pytest.mark.parametrize(
    ("status", "message"),
    [(401, "API key ditolak"), (429, "kuota"), (404, "tidak ditemukan")],
)
def test_provider_errors_are_readable(
    client: TestClient, owner: dict, monkeypatch: pytest.MonkeyPatch, status: int, message: str
) -> None:
    configure(client, owner)
    monkeypatch.setattr(
        ai.httpx, "post", lambda *a, **k: httpx.Response(status, json={"error": {"message": "x"}})
    )
    res = client.post("/reports/ai-analysis", json={}, headers=owner)
    assert res.status_code == 502
    assert message in res.json()["detail"]
    # Analisis yang gagal tidak masuk riwayat.
    assert client.get("/reports/ai-analyses", headers=owner).json() == []


def test_history_lists_newest_first_and_can_be_deleted(
    client: TestClient, owner: dict, cashier: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure(client, owner)
    answers = iter(["pertama", "kedua"])
    monkeypatch.setattr(
        ai.httpx,
        "post",
        lambda *a, **k: httpx.Response(
            200, json={"choices": [{"message": {"content": next(answers)}}]}
        ),
    )
    client.post("/reports/ai-analysis", json={}, headers=owner)
    client.post(
        "/reports/ai-analysis",
        json={"start": "2026-10-01", "end": "2026-10-31", "question": "  "},
        headers=owner,
    )

    history = client.get("/reports/ai-analyses", headers=owner).json()
    assert [h["text"] for h in history] == ["kedua", "pertama"]
    assert history[0]["period_start"] == "2026-10-01" and history[0]["question"] is None
    assert client.get("/reports/ai-analyses", headers=cashier).status_code == 403

    path = f"/reports/ai-analyses/{history[1]['id']}"
    assert client.delete(path, headers=cashier).status_code == 403
    assert client.delete(path, headers=owner).status_code == 204
    assert client.delete(path, headers=owner).status_code == 404
    assert [h["text"] for h in client.get("/reports/ai-analyses", headers=owner).json()] == [
        "kedua"
    ]
