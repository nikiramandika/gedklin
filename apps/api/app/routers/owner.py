from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db, utcnow
from app.models import (
    ACTIVE_STATUSES,
    DailyOperation,
    Order,
    OrderItem,
    OrderStatus,
    Process,
    Role,
    ServiceCatalog,
    ServicePromise,
    User,
)
from app.schemas import (
    AiProviderOut,
    AiSettingsIn,
    AiSettingsOut,
    AppSettingsIn,
    AppSettingsOut,
    CatalogItemCreate,
    CatalogItemOut,
    CatalogItemUpdate,
    DailyCount,
    DailyOperationIn,
    DailyOperationOut,
    DashboardOut,
    ServicePromiseIn,
    ServicePromiseOut,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.security import get_current_user, hash_password, require_roles
from app.services import ai as ai_service
from app.services import catalog as catalog_service
from app.services.activity import diff, log_activity, snapshot
from app.services.app_settings import format_weekdays, load_app_config, save_app_settings
from app.services.operations import LOCAL_TZ

router = APIRouter(tags=["owner"])
owner = require_roles(Role.OWNER)

CATALOG_FIELDS = (
    "name",
    "group",
    "process",
    "unit",
    "price",
    "extra_price",
    "base_kg",
    "min_qty",
    "kg_per_load",
    "pcs_per_load",
    "max_extra",
    "work_minutes",
    "express_eligible",
    "is_active",
)
PROMISE_FIELDS = ("regular_hours", "express_hours", "min_regular_hours")
USER_FIELDS = ("name", "role", "is_active")
DAILY_FIELDS = (
    "is_open",
    "staff_on_duty",
    "washers_available",
    "dryers_available",
    "open_time",
    "close_time",
    "machine_issue_note",
)
ROLE_LABEL = {Role.OWNER: "Pemilik", Role.CASHIER: "Staff Kasir", Role.STAFF: "Staff"}


@router.get("/catalog", response_model=list[CatalogItemOut])
def list_catalog(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    include_inactive: bool = False,
):
    stmt = select(ServiceCatalog).order_by(ServiceCatalog.sort_order, ServiceCatalog.id)
    if not (include_inactive and user.role == Role.OWNER):
        stmt = stmt.where(ServiceCatalog.is_active.is_(True))
    return list(db.scalars(stmt))


def _get_catalog_or_404(db: Session, code: str) -> ServiceCatalog:
    item = db.scalar(select(ServiceCatalog).where(ServiceCatalog.code == code))
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Layanan tidak ditemukan")
    return item


def _normalize_or_422(item: ServiceCatalog) -> None:
    try:
        catalog_service.normalize(item)
    except catalog_service.CatalogError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.post("/catalog", response_model=CatalogItemOut, status_code=status.HTTP_201_CREATED)
def create_catalog_item(
    data: CatalogItemCreate, db: Session = Depends(get_db), me: User = Depends(owner)
) -> ServiceCatalog:
    if db.scalar(select(ServiceCatalog.id).where(ServiceCatalog.code == data.code)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Kode {data.code} sudah dipakai")
    item = ServiceCatalog(**data.model_dump(), sort_order=catalog_service.next_sort_order(db))
    _normalize_or_422(item)
    db.add(item)
    log_activity(
        db,
        me,
        "catalog.create",
        f"Menambah layanan {item.name}",
        entity_id=item.code,
        changes=diff({}, snapshot(item, CATALOG_FIELDS)),
    )
    db.commit()
    return item


@router.put("/catalog/{code}", response_model=CatalogItemOut)
def update_catalog_item(
    code: str, data: CatalogItemUpdate, db: Session = Depends(get_db), me: User = Depends(owner)
) -> ServiceCatalog:
    item = _get_catalog_or_404(db, code)
    before = snapshot(item, CATALOG_FIELDS)
    changes = data.model_dump(exclude_unset=True)
    for key in ("name", "group", "process", "unit", "is_active", "express_eligible"):
        if key in changes and changes[key] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{key} wajib diisi")
    for key, value in changes.items():
        setattr(item, key, value)
    _normalize_or_422(item)
    changed = diff(before, snapshot(item, CATALOG_FIELDS))
    if changed:
        if set(changed) == {"is_active"}:
            verb = "Mengaktifkan" if item.is_active else "Menonaktifkan"
        else:
            verb = "Mengubah"
        log_activity(
            db, me, "catalog.update", f"{verb} layanan {item.name}", entity_id=code, changes=changed
        )
    db.commit()
    return item


@router.delete("/catalog/{code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_catalog_item(
    code: str, db: Session = Depends(get_db), me: User = Depends(owner)
) -> None:
    """Hapus layanan yang belum pernah dipesan. Yang sudah dipakai cukup dinonaktifkan."""
    item = _get_catalog_or_404(db, code)
    used = catalog_service.usage_count(db, code)
    if used:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Layanan sudah dipakai di {used} item pesanan. "
            "Nonaktifkan saja agar riwayat nota tetap utuh.",
        )
    log_activity(db, me, "catalog.delete", f"Menghapus layanan {item.name}", entity_id=code)
    db.delete(item)
    db.commit()


def _settings_out(db: Session) -> AppSettingsOut:
    config = load_app_config(db)
    day = config.default_day
    return AppSettingsOut(
        express_multiplier=config.express_multiplier,
        machine_capacity_kg=config.machine_capacity_kg,
        default_promise_hours=config.default_promise_hours,
        default_staff_on_duty=day.staff_on_duty,
        default_washers_available=day.washers_available,
        default_dryers_available=day.dryers_available,
        default_open_time=day.open_time,
        default_close_time=day.close_time,
        closed_weekdays=sorted(config.closed_weekdays),
        outlet_name=config.outlet.name,
        outlet_address=config.outlet.address,
        outlet_phone=config.outlet.phone,
        wash_minutes_per_load=config.work_rates.wash_minutes_per_load,
        dry_minutes_per_load=config.work_rates.dry_minutes_per_load,
        iron_minutes_per_kg=config.work_rates.iron_minutes_per_kg,
        iron_minutes_per_pcs=config.work_rates.iron_minutes_per_pcs,
    )


def _setting_value(value: object) -> str:
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, list):
        return format_weekdays(value)
    return str(value)


@router.get("/settings", response_model=AppSettingsOut)
def get_app_settings(db: Session = Depends(get_db), _: User = Depends(owner)) -> AppSettingsOut:
    return _settings_out(db)


@router.put("/settings", response_model=AppSettingsOut)
def update_app_settings(
    data: AppSettingsIn, db: Session = Depends(get_db), me: User = Depends(owner)
) -> AppSettingsOut:
    changes = data.model_dump(exclude_none=True)
    current = _settings_out(db)
    open_t = changes.get("default_open_time", current.default_open_time)
    close_t = changes.get("default_close_time", current.default_close_time)
    if close_t <= open_t:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Jam tutup harus setelah jam buka"
        )
    if len(set(changes.get("closed_weekdays", []))) >= 7:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Minimal satu hari harus buka")
    save_app_settings(db, {k: _setting_value(v) for k, v in changes.items()})
    db.flush()
    after = _settings_out(db)
    changed = diff(current.model_dump(), after.model_dump())
    if changed:
        log_activity(db, me, "settings.update", "Mengubah pengaturan", changes=changed)
    db.commit()
    return after


def _ai_settings_out(db: Session) -> AiSettingsOut:
    config = ai_service.load_ai_config(db)
    return AiSettingsOut(
        provider=config.provider,
        model=config.model,
        has_key=config.ready,
        key_hint=ai_service.mask_key(config.api_key),
        providers=[
            AiProviderOut(id=pid, label=p.label, default_model=p.default_model)
            for pid, p in ai_service.PROVIDERS.items()
        ],
    )


def _ai_audit(out: AiSettingsOut) -> dict:
    return {"provider": out.provider, "model": out.model, "api_key": out.key_hint}


@router.get("/settings/ai", response_model=AiSettingsOut)
def get_ai_settings(db: Session = Depends(get_db), _: User = Depends(owner)) -> AiSettingsOut:
    return _ai_settings_out(db)


@router.put("/settings/ai", response_model=AiSettingsOut)
def update_ai_settings(
    data: AiSettingsIn, db: Session = Depends(get_db), me: User = Depends(owner)
) -> AiSettingsOut:
    before = _ai_audit(_ai_settings_out(db))
    ai_service.save_ai_config(
        db,
        provider=data.provider,
        model=data.model,
        api_key=data.api_key,
        clear_key=data.clear_key,
    )
    db.flush()
    after = _ai_settings_out(db)
    changed = diff(before, _ai_audit(after))
    if changed:
        log_activity(db, me, "settings.ai", "Mengubah pengaturan AI", changes=changed)
    db.commit()
    return after


@router.post("/settings/ai/test")
def test_ai_settings(db: Session = Depends(get_db), _: User = Depends(owner)) -> dict[str, str]:
    config = ai_service.load_ai_config(db)
    try:
        reply = ai_service.chat(config, "Jawab singkat.", "Balas dengan satu kata: siap")
    except ai_service.AiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return {"model": config.model, "reply": reply[:100]}


@router.get("/service-promises", response_model=list[ServicePromiseOut])
def list_promises(db: Session = Depends(get_db), _: User = Depends(owner)):
    return list(db.scalars(select(ServicePromise).order_by(ServicePromise.id)))


@router.put("/service-promises/{process}", response_model=ServicePromiseOut)
def upsert_promise(
    process: Process,
    data: ServicePromiseIn,
    db: Session = Depends(get_db),
    me: User = Depends(owner),
) -> ServicePromise:
    row = db.scalar(select(ServicePromise).where(ServicePromise.process == process))
    if row is None:
        row = ServicePromise(process=process)
        db.add(row)
    before = snapshot(row, PROMISE_FIELDS)
    for key, value in data.model_dump().items():
        setattr(row, key, value)
    changed = diff(before, snapshot(row, PROMISE_FIELDS))
    if changed:
        log_activity(
            db,
            me,
            "settings.promise",
            f"Mengubah janji waktu {process.value}",
            entity_id=process.value,
            changes=changed,
        )
    db.commit()
    return row


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(owner)):
    return list(db.scalars(select(User).order_by(User.role, User.name)))


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), me: User = Depends(owner)) -> User:
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
    db.flush()
    log_activity(
        db,
        me,
        "user.create",
        f"Menambah akun {user.name} (@{user.username}, {ROLE_LABEL[user.role]})",
        entity_id=user.id,
    )
    db.commit()
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, data: UserUpdate, db: Session = Depends(get_db), me: User = Depends(owner)
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Akun tidak ditemukan")
    if user.id == me.id and data.is_active is False:
        raise HTTPException(status.HTTP_409_CONFLICT, "Tidak bisa menonaktifkan akun sendiri")
    if data.role is not None and data.role != user.role and user.role == Role.OWNER:
        raise HTTPException(status.HTTP_409_CONFLICT, "Peran akun pemilik tidak bisa diubah")
    before = snapshot(user, USER_FIELDS)
    changes = data.model_dump(exclude_none=True)
    if password := changes.pop("password", None):
        user.password_hash = hash_password(password)
        log_activity(
            db, me, "user.password", f"Mereset password @{user.username}", entity_id=user.id
        )
    for key, value in changes.items():
        setattr(user, key, value)
    changed = diff(before, snapshot(user, USER_FIELDS))
    if changed:
        if set(changed) == {"is_active"}:
            verb = "Mengaktifkan" if user.is_active else "Menonaktifkan"
        else:
            verb = "Mengubah"
        log_activity(
            db,
            me,
            "user.update",
            f"{verb} akun {user.name} (@{user.username})",
            entity_id=user.id,
            changes=changed,
        )
    db.commit()
    return user


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
    day: date, data: DailyOperationIn, db: Session = Depends(get_db), me: User = Depends(owner)
) -> DailyOperation:
    if data.close_time <= data.open_time:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Jam tutup harus setelah jam buka"
        )
    row = db.scalar(select(DailyOperation).where(DailyOperation.date == day))
    before = snapshot(row, DAILY_FIELDS) if row else {}
    if row is None:
        row = DailyOperation(date=day, **data.model_dump())
        db.add(row)
    else:
        for key, value in data.model_dump().items():
            setattr(row, key, value)
    changed = diff(before, snapshot(row, DAILY_FIELDS))
    if changed:
        log_activity(
            db,
            me,
            "operation.update",
            f"Mencatat operasional {day.strftime('%d-%m-%Y')}",
            entity_id=day.isoformat(),
            changes=changed,
        )
    db.commit()
    return row


@router.delete("/daily-operations/{day}", status_code=status.HTTP_204_NO_CONTENT)
def delete_daily_operation(day: date, db: Session = Depends(get_db), me: User = Depends(owner)):
    """Tanggal itu kembali mengikuti jadwal normal."""
    row = db.scalar(select(DailyOperation).where(DailyOperation.date == day))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tidak ada catatan untuk tanggal ini")
    log_activity(
        db,
        me,
        "operation.delete",
        f"Menghapus catatan operasional {day.strftime('%d-%m-%Y')}",
        entity_id=day.isoformat(),
    )
    db.delete(row)
    db.commit()


def _local_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
    return start, start + timedelta(days=1)


@router.get("/dashboard/summary", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), _: User = Depends(owner)) -> DashboardOut:
    today = datetime.now(LOCAL_TZ).date()

    def day_stats(s: datetime, e: datetime) -> tuple[int, int]:
        row = db.execute(
            select(func.count(Order.id), func.coalesce(func.sum(Order.price_total), 0)).where(
                Order.received_at >= s,
                Order.received_at < e,
                Order.status != OrderStatus.CANCELLED,
            )
        ).one()
        return int(row[0]), int(row[1])

    start, end = _local_day_bounds(today)
    today_orders, today_revenue = day_stats(start, end)
    today_kg = db.scalar(
        select(func.coalesce(func.sum(OrderItem.weight_kg), 0.0))
        .join(Order)
        .where(
            Order.received_at >= start,
            Order.received_at < end,
            Order.status != OrderStatus.CANCELLED,
        )
    )

    last_7_days = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        n, revenue = day_stats(*_local_day_bounds(day))
        last_7_days.append(DailyCount(date=day, orders=n, revenue=revenue))

    active_orders = db.scalar(select(func.count(Order.id)).where(Order.status.in_(ACTIVE_STATUSES)))
    active_loads = db.scalar(
        select(func.coalesce(func.sum(OrderItem.machine_loads), 0))
        .join(Order)
        .where(Order.status.in_(ACTIVE_STATUSES))
    )
    status_counts = {
        s.value: int(c)
        for s, c in db.execute(select(Order.status, func.count(Order.id)).group_by(Order.status))
    }

    now = utcnow()
    rows = db.execute(
        select(Order.ready_at, Order.promised_ready_at).where(
            Order.ready_at >= now - timedelta(days=7), Order.promised_ready_at.is_not(None)
        )
    ).all()
    late_hours = [(r - p).total_seconds() / 3600 for r, p in rows if r > p]
    overdue_now = db.scalar(
        select(func.count(Order.id)).where(
            Order.status.in_(ACTIVE_STATUSES), Order.promised_ready_at < now
        )
    )

    return DashboardOut(
        today_orders=today_orders,
        today_revenue=today_revenue,
        today_kg=float(today_kg or 0),
        active_orders=int(active_orders or 0),
        active_loads=int(active_loads or 0),
        ready_not_picked=status_counts.get(OrderStatus.READY.value, 0),
        needs_followup=int(
            db.scalar(select(func.count(Order.id)).where(Order.needs_followup.is_(True))) or 0
        ),
        done_7d=len(rows),
        late_vs_promise_7d=len(late_hours),
        on_time_pct_7d=round(100 * (len(rows) - len(late_hours)) / len(rows), 1) if rows else None,
        avg_late_hours_7d=round(sum(late_hours) / len(late_hours), 1) if late_hours else None,
        overdue_active=int(overdue_now or 0),
        last_7_days=last_7_days,
        status_counts=status_counts,
    )
