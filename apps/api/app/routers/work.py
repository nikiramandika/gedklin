"""Layar Antrean Cucian untuk staff yang mengerjakan cucian di belakang.

Staff hanya melihat isi cucian dan urutannya, lalu menandai mulai diproses dan siap.
Harga, pembayaran, dan nomor HP pelanggan tetap urusan kasir.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Role, User
from app.routers.orders import get_order_or_404
from app.schemas import WorkItemOut, WorkOrderOut, WorkStatusIn
from app.security import require_roles
from app.services import orders as order_service
from app.services.queue import ScheduledOrder, active_schedule

router = APIRouter(prefix="/work", tags=["work"])
worker = require_roles(Role.STAFF, Role.OWNER)


def to_work_out(entry: ScheduledOrder, position: int) -> WorkOrderOut:
    order = entry.order
    return WorkOrderOut(
        id=order.id,
        tracking_code=order.tracking_code,
        customer_name=order.customer.name,
        is_express=order.is_express,
        items=[WorkItemOut.model_validate(i) for i in order.items],
        notes=order.notes,
        rack_location=order.rack_location,
        status=order.status,
        received_at=order.received_at,
        promised_ready_at=order.promised_ready_at,
        queue_position=position,
        next_status=order_service.next_status(order),
        processing_hours=entry.processing_hours,
        slack_hours=entry.slack_hours,
    )


def _work_queue(db: Session) -> list[WorkOrderOut]:
    return [to_work_out(s, i) for i, s in enumerate(active_schedule(db), start=1)]


@router.get("/queue", response_model=list[WorkOrderOut])
def queue(db: Session = Depends(get_db), _: User = Depends(worker)) -> list[WorkOrderOut]:
    """Urutan sama dengan papan kasir: yang sedang diproses, lalu slack terkecil (LST)."""
    return _work_queue(db)


@router.post("/{order_id}/status", response_model=WorkOrderOut)
def change_status(
    order_id: int,
    data: WorkStatusIn,
    db: Session = Depends(get_db),
    user: User = Depends(worker),
) -> WorkOrderOut:
    order = get_order_or_404(db, order_id)
    try:
        order = order_service.change_status(
            db, order, data.to_status, user, rack_location=data.rack_location
        )
    except order_service.OrderError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return next(
        (w for w in _work_queue(db) if w.id == order.id),
        to_work_out(ScheduledOrder(order, 0.0, None), 0),
    )
