from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from abc import ABC, abstractmethod
from datetime import datetime

import httpx

from app.config import Settings, get_settings
from app.models import Order, OrderItem
from app.services.operations import OutletProfile, to_local

logger = logging.getLogger(__name__)


class NotificationSender(ABC):
    @abstractmethod
    def send(self, phone_wa: str, message: str) -> str: ...


class ConsoleSender(NotificationSender):
    def send(self, phone_wa: str, message: str) -> str:
        msg_id = f"console-{uuid.uuid4().hex[:12]}"
        logger.info("[WA %s] ke %s:\n%s", msg_id, phone_wa, message)
        return msg_id


class FonnteSender(NotificationSender):
    URL = "https://api.fonnte.com/send"

    def __init__(self, token: str, timeout: float = 15) -> None:
        if not token:
            raise ValueError("WA_API_KEY (token Fonnte) belum diisi")
        self.token = token
        self.timeout = timeout

    def send(self, phone_wa: str, message: str) -> str:
        target = re.sub(r"\D", "", phone_wa)
        body = urllib.parse.urlencode(
            {"target": target, "message": message, "countryCode": "62"}
        ).encode()
        request = urllib.request.Request(
            self.URL, data=body, method="POST", headers={"Authorization": self.token}
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Fonnte HTTP {exc.code}") from exc
        # Beberapa respons gagal memakai kunci "Status" (huruf besar).
        if not (data.get("status") or data.get("Status")):
            raise RuntimeError(f"Fonnte menolak: {data.get('reason', data)}")
        ids = data.get("id") or []
        return f"fonnte-{ids[0]}" if ids else f"fonnte-req-{data.get('requestid', '')}"


class SendDeferred(Exception):
    """Gateway menunda kiriman (batas harian/pemanasan nomor); ulangi setelah retry_after detik."""

    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class OpenWASender(NotificationSender):
    """OpenWA (github.com/rmyndharis/OpenWA), gateway WhatsApp Web yang dijalankan sendiri."""

    def __init__(self, base_url: str, api_key: str, session_id: str, timeout: float = 30) -> None:
        if not api_key:
            raise ValueError("WA_API_KEY (API key OpenWA) belum diisi")
        if not session_id:
            raise ValueError("OPENWA_SESSION_ID belum diisi")
        self.url = f"{base_url.rstrip('/')}/api/sessions/{session_id}/messages/send-text"
        self.api_key = api_key
        self.timeout = timeout

    @staticmethod
    def chat_id(phone_wa: str) -> str:
        digits = re.sub(r"\D", "", phone_wa)
        if digits.startswith("0"):
            digits = "62" + digits[1:]
        return f"{digits}@c.us"

    def send(self, phone_wa: str, message: str) -> str:
        try:
            res = httpx.post(
                self.url,
                json={"chatId": self.chat_id(phone_wa), "text": message},
                headers={"X-API-Key": self.api_key},
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"OpenWA tidak dapat dihubungi: {exc}") from exc
        try:
            data = res.json()
        except ValueError:
            data = None
        if not isinstance(data, dict):
            data = {}
        if res.status_code == 429 and data.get("code") == "SEND_PACING_LIMITED":
            retry_after = int(data.get("retryAfterSeconds") or 600)
            raise SendDeferred(f"Ditunda batas kirim OpenWA ({retry_after} detik)", retry_after)
        if res.status_code >= 400:
            detail = data.get("message")
            if isinstance(detail, list):
                detail = "; ".join(map(str, detail))
            raise RuntimeError(f"OpenWA HTTP {res.status_code}: {detail or res.text[:200]}")
        return f"openwa-{data.get('messageId', '')}"[:100]


def get_sender(settings: Settings | None = None) -> NotificationSender:
    settings = settings or get_settings()
    provider = settings.wa_provider.lower()
    if provider == "console":
        return ConsoleSender()
    if provider == "fonnte":
        return FonnteSender(settings.wa_api_key)
    if provider == "openwa":
        return OpenWASender(settings.openwa_url, settings.wa_api_key, settings.openwa_session_id)
    raise NotImplementedError(f"Adapter WA untuk provider '{provider}' belum dibuat")


def format_local(dt: datetime) -> str:
    days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
    local = to_local(dt)
    return f"{days[local.weekday()]}, {local:%d/%m/%Y %H:%M} WIB"


def format_rupiah(value: int) -> str:
    return "Rp" + f"{value:,}".replace(",", ".")


def describe_item(item: OrderItem) -> str:
    parts = []
    if item.weight_kg is not None:
        parts.append(f"{item.weight_kg:g} kg")
    if item.qty_pcs:
        parts.append(f"{'+' if item.weight_kg is not None else ''}{item.qty_pcs} pcs")
    return " ".join([item.name, *parts])


def tracking_url(order: Order, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return f"{settings.public_tracking_url.rstrip('/')}/{order.tracking_code}"


def receipt_message(order: Order, outlet: OutletProfile) -> str:
    eta = format_local(order.promised_ready_at) if order.promised_ready_at else "-"
    contact = " · ".join(v for v in (outlet.address, outlet.phone) if v)
    lines = "\n".join(f"- {describe_item(i)}: {format_rupiah(i.subtotal)}" for i in order.items)
    return (
        f"Nota {outlet.name}\n"
        + (f"{contact}\n" if contact else "")
        + f"Kode: {order.tracking_code}\n"
        f"Kecepatan: {'Express' if order.is_express else 'Reguler'}\n"
        f"{lines}\n"
        f"Total: {format_rupiah(order.price_total)} "
        f"({'LUNAS' if order.is_paid else 'belum lunas, bayar saat ambil'})\n"
        + (f"Catatan: {order.notes}\n" if order.notes else "")
        + f"Perkiraan siap: {eta}\n"
        + f"Lacak: {tracking_url(order)}"
    )


def ready_message(order: Order, outlet: OutletProfile) -> str:
    return (
        f"Halo Kak {order.customer.name}, cucian Anda di {outlet.name} sudah SIAP DIAMBIL.\n"
        f"Kode: {order.tracking_code}\n"
        f"Cek status: {tracking_url(order)}\n"
        "Terima kasih!"
    )
