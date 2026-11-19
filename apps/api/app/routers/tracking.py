from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Order
from app.schemas import OutletHoursOut, PublicStatusHistoryOut, TrackingItemOut, TrackingOut
from app.services.app_settings import day_ops_lookup, load_app_config
from gedklin_ml.features import LOCAL_TZ

router = APIRouter(prefix="/public", tags=["public"])


def mask_name(name: str) -> str:
    """Nama samaran untuk portal publik: cukup untuk mengenali pesanan sendiri, mis. "Ni** R."."""
    words = name.split()
    if not words:
        return ""
    first = words[0]
    shown = first[:2] + "*" * min(max(len(first) - 2, 1), 3) if len(first) > 1 else first
    return f"{shown} {words[-1][0].upper()}." if len(words) > 1 else shown


@router.get("/track/{tracking_code}", response_model=TrackingOut)
def track(tracking_code: str, db: Session = Depends(get_db)) -> TrackingOut:
    code = tracking_code.strip().upper()
    order = db.scalar(select(Order).where(Order.tracking_code == code))
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kode pesanan tidak ditemukan")
    today = day_ops_lookup(db, load_app_config(db))(datetime.now(LOCAL_TZ).date())
    return TrackingOut(
        tracking_code=order.tracking_code,
        customer_name=mask_name(order.customer.name),
        whatsapp_updates=order.customer.has_whatsapp,
        is_express=order.is_express,
        items=[TrackingItemOut.model_validate(i) for i in order.items],
        price_total=order.price_total,
        is_paid=order.is_paid,
        status=order.status,
        received_at=order.received_at,
        promised_ready_at=order.promised_ready_at,
        predicted_ready_at=order.predicted_ready_at,
        ready_at=order.ready_at,
        picked_up_at=order.picked_up_at,
        history=[PublicStatusHistoryOut.model_validate(h) for h in order.history],
        outlet_today=OutletHoursOut(
            is_open=today.is_open, open_time=today.open_time, close_time=today.close_time
        ),
    )
