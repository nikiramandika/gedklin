from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Customer,
    Notification,
    Order,
    OrderStatus,
    Role,
    User,
)
from app.schemas import (
    CustomerOut,
    NotificationOut,
    OrderCreate,
    OrderDetailOut,
    OrderOut,
    ReceiptOut,
    StatusChange,
)
from app.security import require_roles
from app.services import orders as order_service
from app.services.notifications import format_local, tracking_url
from app.services.queue import active_orders

router = APIRouter(prefix="/orders", tags=["orders"])
staff = require_roles(Role.CASHIER, Role.OWNER)


def to_out(order: Order, position: int | None = None) -> OrderOut:
    out = OrderOut.model_validate(order)
    out.next_status = order_service.next_status(order)
    out.queue_position = position
    return out


def get_order_or_404(db: Session, order_id: int) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pesanan tidak ditemukan")
    return order


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    data: OrderCreate, db: Session = Depends(get_db), user: User = Depends(staff)
) -> OrderOut:
    try:
        order = order_service.create_order(db, **data.model_dump(), user=user)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return to_out(order)


@router.get("/queue", response_model=list[OrderOut])
def queue(db: Session = Depends(get_db), _: User = Depends(staff)) -> list[OrderOut]:
    """Antrean aktif: Express dulu, lalu FIFO."""
    return [to_out(o, i) for i, o in enumerate(active_orders(db), start=1)]


@router.get("", response_model=list[OrderOut])
def list_orders(
    db: Session = Depends(get_db),
    _: User = Depends(staff),
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, description="Cari nama, nomor WA, atau kode"),
    limit: int = Query(default=50, le=200),
) -> list[OrderOut]:
    stmt = select(Order).join(Customer).order_by(Order.received_at.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(Order.status == status_filter)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Customer.name.ilike(like),
                Customer.phone_wa.ilike(like),
                Order.tracking_code.ilike(like),
            )
        )
    return [to_out(o) for o in db.scalars(stmt).unique()]


@router.get("/customers/lookup", response_model=CustomerOut | None)
def lookup_customer(
    phone: str, db: Session = Depends(get_db), _: User = Depends(staff)
) -> Customer | None:
    try:
        normalized = order_service.normalize_phone(phone)
    except order_service.OrderError:
        return None
    return db.scalar(select(Customer).where(Customer.phone_wa == normalized))


@router.get("/{order_id}", response_model=OrderDetailOut)
def get_order(
    order_id: int, db: Session = Depends(get_db), _: User = Depends(staff)
) -> OrderDetailOut:
    order = get_order_or_404(db, order_id)
    out = OrderDetailOut.model_validate(order)
    out.next_status = order_service.next_status(order)
    return out


@router.post("/{order_id}/status", response_model=OrderOut)
def change_status(
    order_id: int,
    data: StatusChange,
    db: Session = Depends(get_db),
    user: User = Depends(staff),
) -> OrderOut:
    order = get_order_or_404(db, order_id)
    try:
        order = order_service.change_status(db, order, data.to_status, user)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return to_out(order)


@router.get("/{order_id}/receipt", response_model=ReceiptOut)
def receipt(order_id: int, db: Session = Depends(get_db), _: User = Depends(staff)) -> ReceiptOut:
    """Nota digital. Link WA dibuka manual oleh kasir, bukan lewat gateway."""
    order = get_order_or_404(db, order_id)
    url = tracking_url(order)
    layanan = f"{order.service_type.value} {'Express' if order.is_express else 'Reguler'}"
    eta = format_local(order.predicted_ready_at) if order.predicted_ready_at else "-"
    total = f"{order.price_total:,.0f}".replace(",", ".")
    message = (
        f"Nota Gedklin Laundry\n"
        f"Kode: {order.tracking_code}\n"
        f"Layanan: {layanan}\n"
        f"Berat: {order.weight_kg:g} kg\n"
        f"Total: Rp{total}\n"
        f"Perkiraan siap: {eta}\n"
        f"Lacak: {url}"
    )
    return ReceiptOut(
        order=to_out(order),
        tracking_url=url,
        whatsapp_link=f"https://wa.me/{order.customer.phone_wa}?text={quote(message)}",
        message=message,
    )


@router.get("/{order_id}/notifications", response_model=list[NotificationOut])
def notifications(
    order_id: int, db: Session = Depends(get_db), _: User = Depends(staff)
) -> list[Notification]:
    get_order_or_404(db, order_id)
    stmt = (
        select(Notification)
        .where(Notification.order_id == order_id)
        .order_by(Notification.created_at)
    )
    return list(db.scalars(stmt))
