from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db, utcnow
from app.models import ActivityLog, User
from app.schemas import ChangePasswordIn, LoginIn, TokenOut, UserOut
from app.security import create_access_token, get_current_user, hash_password, verify_password
from app.services.activity import log_activity

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_FAILED_LOGINS = 5
LOCKOUT_WINDOW = timedelta(minutes=15)


def _failed_logins(db: Session, username: str) -> int:
    since = utcnow() - LOCKOUT_WINDOW
    return int(
        db.scalar(
            select(func.count(ActivityLog.id)).where(
                ActivityLog.action == "auth.failed",
                ActivityLog.entity_id == username[:40],
                ActivityLog.created_at >= since,
            )
        )
        or 0
    )


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    username = data.username.strip()
    if _failed_logins(db, username) >= MAX_FAILED_LOGINS:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi atau minta pemilik "
            "mereset password.",
        )
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active or not verify_password(data.password, user.password_hash):
        # Dicatat juga untuk username yang tidak ada, supaya tebakan username ikut dibatasi.
        log_activity(
            db, user, "auth.failed", f"Gagal masuk sebagai @{username}", entity_id=username[:40]
        )
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Username atau password salah")
    log_activity(db, user, "auth.login", "Masuk ke aplikasi", entity_id=user.id)
    db.commit()
    return TokenOut(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: ChangePasswordIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Petugas mengganti password sendiri."""
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password saat ini salah")
    if data.current_password == data.new_password:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Password baru harus berbeda dari yang lama"
        )
    user.password_hash = hash_password(data.new_password)
    log_activity(db, user, "user.password", "Mengganti password sendiri", entity_id=user.id)
    db.commit()
