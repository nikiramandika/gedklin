"""Data pelanggan: daftar, riwayat pesanan, dan koreksi nama/nomor WA."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Customer, Order, OrderStatus, Role, User
from app.routers.orders import to_out
from app.schemas import CustomerDetailOut, CustomerSummaryOut, CustomerUpdate
from app.security import require_roles
from app.services.activity import diff, log_activity
from app.services.orders import OrderError, normalize_phone

router = APIRouter(prefix="/customers", tags=["customers"])
staff = require_roles(Role.CASHIER, Role.OWNER)

NOT_CANCELLED = Order.status != OrderStatus.CANCELLED


def _stats_query():  # noqa: ANN202
    spent = func.coalesce(func.sum(case((NOT_CANCELLED, Order.price_total), else_=0)), 0)
    unpaid = func.coalesce(
        func.sum(case((NOT_CANCELLED & Order.paid_at.is_(None), Order.price_total), else_=0)), 0
    )
    return (
        select(
            Customer,
            func.count(case((NOT_CANCELLED, Order.id))).label("order_count"),
            spent.label("total_spent"),
            unpaid.label("unpaid_total"),
            func.max(Order.received_at).label("last_order_at"),
        )
        .outerjoin(Order, Order.customer_id == Customer.id)
        .group_by(Customer.id)
    )


def _summary(c: Customer, order_count: int, spent: int, unpaid: int, last: datetime | None) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "phone_wa": c.phone_wa,
        "created_at": c.created_at,
        "order_count": int(order_count or 0),
        "total_spent": int(spent or 0),
        "unpaid_total": int(unpaid or 0),
        "last_order_at": last,
    }


@router.get("", response_model=list[CustomerSummaryOut])
def list_customers(
    db: Session = Depends(get_db),
    _: User = Depends(staff),
    q: str | None = Query(default=None, max_length=100, description="Nama atau nomor WA"),
    unpaid_only: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[dict]:
    """Pelanggan dengan pesanan terbaru di atas."""
    stmt = _stats_query()
    if q and q.strip():
        term = q.strip()
        digits = "".join(ch for ch in term if ch.isdigit())
        conditions = [Customer.name.ilike(f"%{term}%")]
        if len(digits) >= 4:
            # 0812... dan 62812... sama-sama ketemu.
            conditions.append(Customer.phone_wa.like(f"%{digits.lstrip('0')}%"))
        stmt = stmt.where(or_(*conditions))
    if unpaid_only:
        stmt = stmt.having(
            func.sum(case((NOT_CANCELLED & Order.paid_at.is_(None), Order.price_total), else_=0))
            > 0
        )
    stmt = (
        stmt.order_by(func.max(Order.received_at).desc().nulls_last(), Customer.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [_summary(*row) for row in db.execute(stmt).unique()]


def _get_or_404(db: Session, customer_id: int) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pelanggan tidak ditemukan")
    return customer


def _detail(db: Session, customer: Customer) -> dict:
    row = db.execute(_stats_query().where(Customer.id == customer.id)).one()
    orders = db.scalars(
        select(Order)
        .where(Order.customer_id == customer.id)
        .order_by(Order.received_at.desc())
        .limit(100)
    ).unique()
    return {**_summary(*row), "orders": [to_out(o) for o in orders]}


@router.get("/{customer_id}", response_model=CustomerDetailOut)
def get_customer(customer_id: int, db: Session = Depends(get_db), _: User = Depends(staff)) -> dict:
    return _detail(db, _get_or_404(db, customer_id))


@router.patch("/{customer_id}", response_model=CustomerDetailOut)
def update_customer(
    customer_id: int,
    data: CustomerUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(staff),
) -> dict:
    customer = _get_or_404(db, customer_id)
    before = {"nama": customer.name, "no_wa": customer.phone_wa}
    if data.name is not None:
        customer.name = data.name.strip()
    if data.phone_wa is not None:
        try:
            phone = normalize_phone(data.phone_wa)
        except OrderError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
        taken = db.scalar(
            select(Customer.id).where(Customer.phone_wa == phone, Customer.id != customer.id)
        )
        if taken:
            raise HTTPException(status.HTTP_409_CONFLICT, "Nomor WA sudah dipakai pelanggan lain")
        customer.phone_wa = phone
    changed = diff(before, {"nama": customer.name, "no_wa": customer.phone_wa})
    if changed:
        log_activity(
            db,
            user,
            "customer.update",
            f"Mengubah data pelanggan {customer.name}",
            entity_id=customer.id,
            changes=changed,
        )
        db.commit()
    return _detail(db, customer)
