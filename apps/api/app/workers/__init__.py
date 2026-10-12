from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

settings = get_settings()

celery_app = Celery("gedklin", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    timezone="Asia/Jakarta",
    enable_utc=True,
    task_always_eager=settings.celery_task_always_eager,
    task_acks_late=True,
    beat_schedule={
        "tandai-pesanan-belum-diambil": {
            "task": "app.workers.tasks.mark_followups_task",
            "schedule": crontab(hour=8, minute=0),
        },
        "kirim-ulang-notifikasi-pending": {
            "task": "app.workers.tasks.resend_pending_notifications",
            "schedule": crontab(minute="*/15"),
        },
    },
)
celery_app.autodiscover_tasks(["app.workers"], related_name="tasks")

# `celery -A app.workers worker` mencari atribut bernama `celery`.
celery = celery_app
