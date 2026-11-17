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
    CancelIn,
    CustomerOut,
    NotificationOut,
    OrderCreate,
    OrderDetailOut,
    OrderDetailsUpdate,
    OrderItemIn,
    OrderOut,
    PaymentIn,
    QuoteIn,
    QuoteOut,
    ReceiptOut,
    StatusChange,
)
from app.security import require_roles
from app.services import orders as order_service
from app.services.notifications import receipt_message, tracking_url
from app.services.pricing import ItemRequest
from app.services.queue import active_orders

router = APIRouter(prefix="/orders", tags=["orders"])
staff = require_roles(Role.CASHIER, Role.OWNER)
owner_only = require_roles(Role.OWNER)


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


def to_requests(items: list[OrderItemIn]) -> list[ItemRequest]:
    return [ItemRequest(i.catalog_code, i.weight_kg, i.qty_pcs) for i in items]


@router.post("/quote", response_model=QuoteOut)
def quote_order(data: QuoteIn, db: Session = Depends(get_db), _: User = Depends(staff)) -> QuoteOut:
    """Hitung harga tanpa menyimpan, untuk ditampilkan di form kasir."""
    try:
        result = order_service.quote_order(db, to_requests(data.items), data.is_express)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return QuoteOut.model_validate(result, from_attributes=True)


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    data: OrderCreate, db: Session = Depends(get_db), user: User = Depends(staff)
) -> OrderOut:
    try:
        order = order_service.create_order(
            db,
            customer_name=data.customer_name,
            customer_phone=data.customer_phone,
            is_express=data.is_express,
            items=to_requests(data.items),
            user=user,
            notes=data.notes,
            payment_method=data.payment_method,
        )
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return to_out(order)


@router.get("/queue", response_model=list[OrderOut])
def queue(db: Session = Depends(get_db), _: User = Depends(staff)) -> list[OrderOut]:
    """Antrean aktif: yang sedang diproses, Express, Reguler mendekati janji, lalu FIFO."""
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
        order = order_service.change_status(
            db,
            order,
            data.to_status,
            user,
            rack_location=data.rack_location,
            payment_method=data.payment_method,
        )
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return to_out(order)


@router.patch("/{order_id}", response_model=OrderOut)
def update_order_details(
    order_id: int,
    data: OrderDetailsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(staff),
) -> OrderOut:
    """Ubah catatan pesanan dan/atau lokasi rak."""
    order = get_order_or_404(db, order_id)
    fields = data.model_dump(exclude_unset=True)
    return to_out(order_service.update_details(db, order, user, fields=fields))


@router.put("/{order_id}/items", response_model=OrderOut)
def update_order_items(
    order_id: int, data: QuoteIn, db: Session = Depends(get_db), user: User = Depends(staff)
) -> OrderOut:
    """Koreksi isi pesanan (salah input) sebelum siap diambil dan sebelum lunas."""
    order = get_order_or_404(db, order_id)
    try:
        order = order_service.update_items(
            db, order, to_requests(data.items), data.is_express, user
        )
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return to_out(order)


@router.post("/{order_id}/payment", response_model=OrderOut)
def record_payment(
    order_id: int, data: PaymentIn, db: Session = Depends(get_db), user: User = Depends(staff)
) -> OrderOut:
    order = get_order_or_404(db, order_id)
    try:
        order = order_service.record_payment(db, order, data.method, user)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return to_out(order)


@router.delete("/{order_id}/payment", response_model=OrderOut)
def void_payment(
    order_id: int, db: Session = Depends(get_db), user: User = Depends(owner_only)
) -> OrderOut:
    """Koreksi pembayaran yang salah dicatat. Hanya pemilik."""
    order = get_order_or_404(db, order_id)
    try:
        order = order_service.void_payment(db, order, user)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return to_out(order)


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(
    order_id: int, data: CancelIn, db: Session = Depends(get_db), user: User = Depends(staff)
) -> OrderOut:
    order = get_order_or_404(db, order_id)
    try:
        order = order_service.cancel_order(db, order, data.reason, user)
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return to_out(order)


@router.get("/{order_id}/receipt", response_model=ReceiptOut)
def receipt(order_id: int, db: Session = Depends(get_db), _: User = Depends(staff)) -> ReceiptOut:
    """Nota digital. Nota sudah dikirim otomatis lewat gateway saat pesanan dibuat;
    link WA di sini untuk kirim ulang manual oleh kasir."""
    order = get_order_or_404(db, order_id)
    message = receipt_message(order)
    return ReceiptOut(
        order=to_out(order),
        tracking_url=tracking_url(order),
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
