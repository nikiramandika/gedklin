"""Notifikasi WhatsApp: interface sender + adapter per provider, dan aturan pengiriman."""

from __future__ import annotations

import logging
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


def get_sender(settings: Settings | None = None) -> NotificationSender:
    settings = settings or get_settings()
    provider = settings.wa_provider.lower()
    if provider == "console":
        return ConsoleSender()
    # Provider WhatsApp gateway belum dipilih. Tambahkan adapter baru di sini.
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
