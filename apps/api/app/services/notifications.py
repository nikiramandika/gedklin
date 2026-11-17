"""Notifikasi WhatsApp: interface sender + adapter per provider, dan aturan pengiriman."""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timedelta

from app.config import Settings, get_settings
from app.models import Order, OrderItem
from gedklin_ml.features import to_local

logger = logging.getLogger(__name__)


class NotificationSender(ABC):
    @abstractmethod
    def send(self, phone_wa: str, message: str) -> str:
        """Kirim pesan dan kembalikan id pesan dari provider. Raise jika gagal."""


class ConsoleSender(NotificationSender):
    """Mode dev: hanya menulis pesan ke log."""

    def send(self, phone_wa: str, message: str) -> str:
        msg_id = f"console-{uuid.uuid4().hex[:12]}"
        logger.info("[WA %s] ke %s:\n%s", msg_id, phone_wa, message)
        return msg_id


class FonnteSender(NotificationSender):
    """WhatsApp lewat Fonnte (https://docs.fonnte.com/api-send-message/).

    Nomor 08xx diubah Fonnte menjadi 628xx (countryCode 62). Device harus terhubung:
    bila tidak, Fonnte menolak (connectOnly) dan task Celery mencoba ulang.
    """

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


def get_sender(settings: Settings | None = None) -> NotificationSender:
    settings = settings or get_settings()
    provider = settings.wa_provider.lower()
    if provider == "console":
        return ConsoleSender()
    if provider == "fonnte":
        return FonnteSender(settings.wa_api_key)
    raise NotImplementedError(f"Adapter WA untuk provider '{provider}' belum dibuat")


def should_send_delay(order: Order, new_eta: datetime, settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if order.is_express or order.last_notified_eta is None:
        return False
    if order.delay_notif_count >= settings.max_delay_notifications:
        return False
    return new_eta > order.last_notified_eta + timedelta(hours=settings.delay_threshold_hours)


def format_local(dt: datetime) -> str:
    days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
    local = to_local(dt)
    return f"{days[local.weekday()]}, {local:%d/%m/%Y %H:%M} WIB"


def format_rupiah(value: int) -> str:
    return "Rp" + f"{value:,}".replace(",", ".")


def describe_item(item: OrderItem) -> str:
    """Mis. "Cuci + Kering + Setrika 8 kg" atau "Kemeja Lengan Panjang 2 pcs"."""
    parts = []
    if item.weight_kg is not None:
        parts.append(f"{item.weight_kg:g} kg")
    if item.qty_pcs:
        parts.append(f"{'+' if item.weight_kg is not None else ''}{item.qty_pcs} pcs")
    return " ".join([item.name, *parts])


def tracking_url(order: Order, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return f"{settings.public_tracking_url.rstrip('/')}/{order.tracking_code}"


def receipt_message(order: Order) -> str:
    """Nota digital: dikirim otomatis saat pesanan dibuat, juga dipakai tombol WA manual."""
    eta = format_local(order.predicted_ready_at) if order.predicted_ready_at else "-"
    promise = order.promised_ready_at
    # Janji standar = batas "terlambat"; ditulis hanya bila berbeda dari perkiraan.
    promise_line = (
        f"Janji standar layanan: {format_local(promise)}\n"
        if promise and promise != order.predicted_ready_at
        else ""
    )
    lines = "\n".join(f"- {describe_item(i)}: {format_rupiah(i.subtotal)}" for i in order.items)
    return (
        f"Nota Gedklin Laundry\n"
        f"Kode: {order.tracking_code}\n"
        f"Kecepatan: {'Express' if order.is_express else 'Reguler'}\n"
        f"{lines}\n"
        f"Total: {format_rupiah(order.price_total)} "
        f"({'LUNAS' if order.is_paid else 'belum lunas, bayar saat ambil'})\n"
        + (f"Catatan: {order.notes}\n" if order.notes else "")
        + f"Perkiraan siap: {eta}\n"
        + promise_line
        + f"Lacak: {tracking_url(order)}"
    )


def ready_message(order: Order) -> str:
    return (
        f"Halo Kak {order.customer.name}, cucian Anda di Gedklin Laundry sudah SIAP DIAMBIL.\n"
        f"Kode: {order.tracking_code}\n"
        f"Cek status: {tracking_url(order)}\n"
        "Terima kasih!"
    )


def delay_message(order: Order, new_eta: datetime) -> str:
    return (
        f"Halo Kak {order.customer.name}, mohon maaf antrean Gedklin Laundry sedang ramai.\n"
        f"Perkiraan cucian Anda siap diambil menjadi {format_local(new_eta)}.\n"
        f"Cek status: {tracking_url(order)}"
    )
