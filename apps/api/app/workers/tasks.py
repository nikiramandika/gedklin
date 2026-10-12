from __future__ import annotations

import logging
from datetime import timedelta

from celery import Task
from sqlalchemy import select

from app.db import SessionLocal, utcnow
from app.models import Notification, NotificationStatus, NotificationType, Order
from app.services.notifications import delay_message, get_sender, ready_message
from app.services.orders import mark_followups
from app.workers import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_notification(self: Task, notification_id: int) -> str:
    """Kirim satu baris notifikasi. Idempoten: baris yang sudah SENT dilewati."""
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

        if notif.type == NotificationType.READY:
            message = ready_message(order)
        else:
            message = delay_message(order, order.last_notified_eta or order.predicted_ready_at)

        try:
            msg_id = get_sender().send(order.customer.phone_wa, message)
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
    """Antrekan ulang notifikasi PENDING yang tertinggal (mis. broker sempat mati)."""
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
