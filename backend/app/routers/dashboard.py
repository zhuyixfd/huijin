from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, Order, OrderItem
from app.models import User as UserModel
from app.schemas_business import DashboardSummary

router = APIRouter()


@router.get("/summary", response_model=DashboardSummary)
def summary(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    customer_count = db.scalar(select(func.count()).select_from(Customer)) or 0
    order_count = db.scalar(select(func.count()).select_from(Order)) or 0
    item_count = db.scalar(select(func.count()).select_from(OrderItem)) or 0

    rows = db.execute(
        select(OrderItem.production_status, func.count(OrderItem.id)).group_by(
            OrderItem.production_status
        )
    ).all()
    status_counts = {str(r[0]): int(r[1]) for r in rows}

    return DashboardSummary(
        customer_count=int(customer_count),
        order_count=int(order_count),
        item_count=int(item_count),
        status_counts=status_counts,
    )
