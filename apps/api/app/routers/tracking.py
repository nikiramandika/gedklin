"""Portal tracking publik. Hanya menerima tracking_code, tanpa data pribadi."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Order
from app.schemas import PublicStatusHistoryOut, TrackingItemOut, TrackingOut

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/track/{tracking_code}", response_model=TrackingOut)
def track(tracking_code: str, db: Session = Depends(get_db)) -> TrackingOut:
    code = tracking_code.strip().upper()
    order = db.scalar(select(Order).where(Order.tracking_code == code))
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kode pesanan tidak ditemukan")
    return TrackingOut(
        tracking_code=order.tracking_code,
        is_express=order.is_express,
        items=[TrackingItemOut.model_validate(i) for i in order.items],
        status=order.status,
        received_at=order.received_at,
        promised_ready_at=order.promised_ready_at,
        predicted_ready_at=order.predicted_ready_at,
        ready_at=order.ready_at,
        picked_up_at=order.picked_up_at,
        history=[PublicStatusHistoryOut.model_validate(h) for h in order.history],
    )
