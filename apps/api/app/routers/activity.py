"""Log aktivitas petugas, hanya untuk pemilik."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ActivityLog, Role, User
from app.schemas import ActivityLogOut
from app.security import require_roles

router = APIRouter(prefix="/activity-logs", tags=["activity"])


@router.get("", response_model=list[ActivityLogOut])
def list_activity(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(Role.OWNER)),
    entity_type: str | None = Query(default=None, max_length=20),
    user_id: int | None = None,
    q: str | None = Query(
        default=None,
        max_length=100,
        description="Kode pesanan (cocok persis) atau teks di ringkasan, mis. nama pelanggan",
    ),
    before_id: int | None = Query(default=None, description="Untuk halaman berikutnya"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ActivityLog]:
    """Terbaru dulu. Halaman berikutnya: kirim `before_id` = id terakhir yang diterima.

    Mencari kode pesanan menampilkan seluruh jejaknya: diterima, diproses, siap, diambil.
    """
    stmt = select(ActivityLog).order_by(ActivityLog.id.desc()).limit(limit)
    if entity_type:
        stmt = stmt.where(ActivityLog.entity_type == entity_type)
    if user_id is not None:
        stmt = stmt.where(ActivityLog.user_id == user_id)
    if q and q.strip():
        term = q.strip()
        stmt = stmt.where(
            or_(
                ActivityLog.entity_id == term.upper(),
                ActivityLog.summary.ilike(f"%{term}%"),
            )
        )
    if before_id is not None:
        stmt = stmt.where(ActivityLog.id < before_id)
    return list(db.scalars(stmt).unique())
