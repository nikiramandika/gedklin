from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Order, OrderStatus, Role, User
from app.routers.orders import to_out
from app.schemas import OrderOut
from app.security import require_roles

router = APIRouter(prefix="/followups", tags=["followups"])


@router.get("", response_model=list[OrderOut])
def followups(
    db: Session = Depends(get_db), _: User = Depends(require_roles(Role.CASHIER, Role.OWNER))
) -> list[OrderOut]:
    """Pesanan siap yang belum diambil > 3 hari. Kasir menghubungi pelanggan manual."""
    stmt = (
        select(Order)
        .where(Order.needs_followup.is_(True), Order.status == OrderStatus.READY)
        .order_by(Order.ready_at.asc())
    )
    return [to_out(o) for o in db.scalars(stmt)]
