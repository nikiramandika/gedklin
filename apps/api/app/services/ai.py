"""Analisis laporan dengan model bahasa (Gemini atau OpenRouter).

Keduanya punya endpoint yang kompatibel dengan OpenAI Chat Completions, jadi cukup
satu klien; yang berbeda hanya base URL. API key disimpan terenkripsi di
app_settings dan tidak pernah dikirim balik ke browser.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AppSetting


@dataclass(frozen=True)
class Provider:
    label: str
    base_url: str
    default_model: str


PROVIDERS: dict[str, Provider] = {
    "gemini": Provider(
        "Google Gemini",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "gemini-2.5-flash",
    ),
    "openrouter": Provider(
        "OpenRouter",
        "https://openrouter.ai/api/v1",
        "google/gemini-2.5-flash",
    ),
}
DEFAULT_PROVIDER = "gemini"
TIMEOUT_SECONDS = 60
KEY_PROVIDER = "ai_provider"
KEY_MODEL = "ai_model"
KEY_API_KEY = "ai_api_key"


class AiError(Exception):
    pass


@dataclass(frozen=True)
class AiConfig:
    provider: str
    model: str
    api_key: str | None

    @property
    def ready(self) -> bool:
        return bool(self.api_key)


def _fernet() -> Fernet:
    # Diturunkan dari JWT_SECRET; bila secret diganti, key lama tidak terbaca dan perlu diisi ulang.
    digest = hashlib.sha256(f"gedklin-ai:{get_settings().jwt_secret}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _get(db: Session, key: str) -> str | None:
    row = db.get(AppSetting, key)
    return row.value if row else None


def _put(db: Session, key: str, value: str | None) -> None:
    row = db.get(AppSetting, key)
    if value is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def load_ai_config(db: Session) -> AiConfig:
    provider = _get(db, KEY_PROVIDER) or DEFAULT_PROVIDER
    if provider not in PROVIDERS:
        provider = DEFAULT_PROVIDER
    model = _get(db, KEY_MODEL) or PROVIDERS[provider].default_model
    api_key = None
    if token := _get(db, KEY_API_KEY):
        try:
            api_key = _fernet().decrypt(token.encode()).decode()
        except InvalidToken:
            api_key = None
    return AiConfig(provider=provider, model=model, api_key=api_key)


def save_ai_config(
    db: Session, *, provider: str, model: str | None, api_key: str | None, clear_key: bool = False
) -> None:
    if provider not in PROVIDERS:
        raise AiError("Penyedia AI tidak dikenal")
    _put(db, KEY_PROVIDER, provider)
    _put(db, KEY_MODEL, (model or "").strip() or None)
    if clear_key:
        _put(db, KEY_API_KEY, None)
    elif api_key and api_key.strip():
        _put(db, KEY_API_KEY, _fernet().encrypt(api_key.strip().encode()).decode())


def mask_key(api_key: str | None) -> str | None:
    if not api_key:
        return None
    return f"{api_key[:4]}…{api_key[-4:]}" if len(api_key) > 12 else "••••"


def _provider_message(res: httpx.Response) -> str:
    try:
        body = res.json()
    except ValueError:
        return res.text[:200]
    # Gemini kadang membungkus error dalam list.
    if isinstance(body, list) and body:
        body = body[0]
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:300]
    return res.text[:200]


def chat(config: AiConfig, system: str, user: str) -> str:
    if not config.api_key:
        raise AiError("API key AI belum diisi. Isi di Pengaturan → Analisis AI.")
    provider = PROVIDERS[config.provider]
    headers = {"Authorization": f"Bearer {config.api_key}"}
    if config.provider == "openrouter":
        headers["X-Title"] = "Gedklin"
    payload = {
        "model": config.model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.3,
    }
    try:
        res = httpx.post(
            f"{provider.base_url}/chat/completions",
            json=payload,
            headers=headers,
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.TimeoutException as exc:
        raise AiError("Penyedia AI tidak menjawab dalam 60 detik. Coba lagi.") from exc
    except httpx.HTTPError as exc:
        raise AiError(f"Tidak dapat terhubung ke {provider.label}") from exc

    if res.status_code in (401, 403):
        raise AiError(f"API key ditolak {provider.label}. Periksa kembali key-nya.")
    if res.status_code == 429:
        raise AiError("Batas pemakaian/kuota AI habis. Coba beberapa saat lagi.")
    if res.status_code == 404:
        raise AiError(f"Model {config.model} tidak ditemukan di {provider.label}.")
    if res.status_code >= 400:
        raise AiError(f"{provider.label}: {_provider_message(res)}")

    try:
        content = res.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AiError("Jawaban AI tidak dapat dibaca") from exc
    if not content or not str(content).strip():
        raise AiError("AI tidak memberikan jawaban. Coba model lain.")
    return str(content).strip()
