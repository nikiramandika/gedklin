"""Fitur pemilik: layanan/harga, akun, operasional harian, dasbor."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db, utcnow
from app.models import (
    ACTIVE_STATUSES,
    DailyOperation,
    Order,
    OrderStatus,
    Role,
    Service,
    ServiceType,
    User,
)
from app.schemas import (
    DailyCount,
    DailyOperationIn,
    DailyOperationOut,
    DashboardOut,
    ServiceOut,
    ServiceUpdate,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.security import get_current_user, hash_password, require_roles
from app.services.eta import get_predictor
from gedklin_ml.features import LOCAL_TZ

router = APIRouter(tags=["owner"])
owner = require_roles(Role.OWNER)


# --- Layanan ---------------------------------------------------------------


@router.get("/services", response_model=list[ServiceOut])
def list_services(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return list(db.scalars(select(Service).order_by(Service.code)))


@router.put("/services/{code}", response_model=ServiceOut)
def update_service(
    code: ServiceType, data: ServiceUpdate, db: Session = Depends(get_db), _: User = Depends(owner)
) -> Service:
    service = db.scalar(select(Service).where(Service.code == code))
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Layanan tidak ditemukan")
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(service, key, value)
    db.commit()
    return service


# --- Akun ------------------------------------------------------------------


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(owner)):
    return list(db.scalars(select(User).order_by(User.role, User.name)))


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), _: User = Depends(owner)) -> User:
    if db.scalar(select(User.id).where(User.username == data.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Username sudah dipakai")
    user = User(
        name=data.name,
        username=data.username,
        password_hash=hash_password(data.password),
        role=data.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, data: UserUpdate, db: Session = Depends(get_db), me: User = Depends(owner)
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Akun tidak ditemukan")
    if user.id == me.id and (data.is_active is False or (data.role and data.role != Role.OWNER)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Tidak bisa menonaktifkan akun sendiri")
    changes = data.model_dump(exclude_none=True)
    if password := changes.pop("password", None):
        user.password_hash = hash_password(password)
    for key, value in changes.items():
        setattr(user, key, value)
    db.commit()
    return user


# --- Operasional harian ----------------------------------------------------


@router.get("/daily-operations", response_model=list[DailyOperationOut])
def list_daily_operations(
    db: Session = Depends(get_db),
    _: User = Depends(owner),
    days: int = Query(default=14, le=90),
):
    since = datetime.now(LOCAL_TZ).date() - timedelta(days=days)
    stmt = (
        select(DailyOperation)
        .where(DailyOperation.date >= since)
        .order_by(DailyOperation.date.desc())
    )
    return list(db.scalars(stmt))


@router.put("/daily-operations/{day}", response_model=DailyOperationOut)
def upsert_daily_operation(
    day: date, data: DailyOperationIn, db: Session = Depends(get_db), _: User = Depends(owner)
) -> DailyOperation:
    if data.close_time <= data.open_time:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Jam tutup harus setelah jam buka"
        )
    row = db.scalar(select(DailyOperation).where(DailyOperation.date == day))
    if row is None:
        row = DailyOperation(date=day, **data.model_dump())
        db.add(row)
    else:
        for key, value in data.model_dump().items():
            setattr(row, key, value)
    db.commit()
    return row


# --- Dasbor ----------------------------------------------------------------


def _local_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
    return start, start + timedelta(days=1)


@router.get("/dashboard/summary", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), _: User = Depends(owner)) -> DashboardOut:
    today = datetime.now(LOCAL_TZ).date()
    start, end = _local_day_bounds(today)

    def day_stats(s: datetime, e: datetime) -> tuple[int, Decimal, float]:
        row = db.execute(
            select(
                func.count(Order.id),
                func.coalesce(func.sum(Order.price_total), 0),
                func.coalesce(func.sum(Order.weight_kg), 0.0),
            ).where(Order.received_at >= s, Order.received_at < e)
        ).one()
        return int(row[0]), Decimal(row[1]), float(row[2])

    today_orders, today_revenue, today_kg = day_stats(start, end)

    last_7_days = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        n, revenue, _kg = day_stats(*_local_day_bounds(day))
        last_7_days.append(DailyCount(date=day, orders=n, revenue=revenue))

    active = db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.weight_kg), 0.0)).where(
            Order.status.in_(ACTIVE_STATUSES)
        )
    ).one()
    status_counts = {
        s.value: int(c)
        for s, c in db.execute(select(Order.status, func.count(Order.id)).group_by(Order.status))
    }

    # Akurasi ETA 7 hari terakhir: |ready_at - predicted_ready_at| untuk pesanan READY.
    since = utcnow() - timedelta(days=7)
    pairs = db.execute(
        select(Order.ready_at, Order.predicted_ready_at).where(
            Order.ready_at >= since, Order.predicted_ready_at.is_not(None)
        )
    ).all()
    errors = [abs((r - p).total_seconds()) / 60 for r, p in pairs if r and p]

    return DashboardOut(
        today_orders=today_orders,
        today_revenue=today_revenue,
        today_kg=today_kg,
        active_orders=int(active[0]),
        active_kg=float(active[1]),
        ready_not_picked=status_counts.get(OrderStatus.READY.value, 0),
        needs_followup=int(
            db.scalar(select(func.count(Order.id)).where(Order.needs_followup.is_(True))) or 0
        ),
        eta_mae_minutes_7d=round(sum(errors) / len(errors), 1) if errors else None,
        eta_samples_7d=len(errors),
        model_version=get_predictor().model_version,
        last_7_days=last_7_days,
        status_counts=status_counts,
    )
