from __future__ import annotations

import logging
from datetime import timedelta

from celery import Task
from sqlalchemy import select

from app.db import SessionLocal, utcnow
from app.models import Notification, NotificationStatus, NotificationType, Order
from app.services.app_settings import load_app_config
from app.services.notifications import (
    SendDeferred,
    get_sender,
    ready_message,
    receipt_message,
)
from app.services.orders import mark_followups
from app.workers import celery_app

logger = logging.getLogger(__name__)
# Penundaan karena batas kirim harian bisa berjam-jam; cukup untuk ±1 hari.
MAX_DEFERRALS = 30


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_notification(self: Task, notification_id: int) -> str:
    with SessionLocal() as db:
        notif = db.get(Notification, notification_id, with_for_update=True)
        if notif is None:
            return "missing"
        if notif.status == NotificationStatus.SENT:
            return "already-sent"
        order = db.get(Order, notif.order_id)
        if order is None:
            return "missing-order"
        if notif.type == NotificationType.READY and order.ready_notif_sent:
            return "already-sent"
        if not order.customer.has_whatsapp:
            # Antre sebelum pelanggan ditandai tanpa WhatsApp: jangan kirim ke nomor tanpa WA.
            notif.status = NotificationStatus.FAILED
            notif.error = "Pelanggan tidak pakai WhatsApp"
            db.commit()
            return "no-whatsapp"

        if notif.type == NotificationType.RECEIPT:
            message = receipt_message(order, load_app_config(db).outlet)
        elif notif.type == NotificationType.READY:
            message = ready_message(order, load_app_config(db).outlet)
        else:
            # Kabar "perkiraan mundur" sisa prediksi ML lama: tidak dikirim lagi.
            notif.status = NotificationStatus.FAILED
            notif.error = "Jenis notifikasi sudah tidak dipakai"
            db.commit()
            return "obsolete"

        try:
            msg_id = get_sender().send(order.customer.phone_wa, message)
        except SendDeferred as exc:
            # Bukan gagal: gateway sedang membatasi kiriman. FAILED supaya tidak diantrekan ulang
            # oleh resend_pending_notifications; jeda maks 55 menit agar di bawah visibility
            # timeout Redis (1 jam) sehingga task tidak terkirim ganda.
            notif.status = NotificationStatus.FAILED
            notif.error = str(exc)[:500]
            db.commit()
            logger.info("Notifikasi %s ditunda: %s", notification_id, exc)
            raise self.retry(
                exc=exc, countdown=min(exc.retry_after, 55 * 60), max_retries=MAX_DEFERRALS
            ) from exc
        except Exception as exc:
            notif.status = NotificationStatus.FAILED
            notif.error = str(exc)[:500]
            db.commit()
            logger.warning("Notifikasi %s gagal: %s", notification_id, exc)
            raise self.retry(exc=exc) from exc

        notif.status = NotificationStatus.SENT
        notif.sent_at = utcnow()
        notif.provider_msg_id = msg_id
        notif.error = None
        if notif.type == NotificationType.READY:
            order.ready_notif_sent = True
        db.commit()
        return "sent"


@celery_app.task
def resend_pending_notifications() -> int:
    cutoff = utcnow() - timedelta(minutes=10)
    with SessionLocal() as db:
        ids = list(
            db.scalars(
                select(Notification.id).where(
                    Notification.status == NotificationStatus.PENDING,
                    Notification.created_at < cutoff,
                )
            )
        )
    for notification_id in ids:
        send_notification.delay(notification_id)
    return len(ids)


@celery_app.task
def mark_followups_task() -> int:
    with SessionLocal() as db:
        return mark_followups(db)
