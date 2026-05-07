from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, Order, OrderItem
from app.models import User as UserModel
from app.schemas_business import OrderItemOut, TaskItemOut

router = APIRouter()


@router.get("/items", response_model=list[TaskItemOut])
def list_task_items(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None, description="生产编号/来料编号/订单号"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    stmt = (
        select(OrderItem, Order.order_no, Customer.name)
        .join(Order, OrderItem.order_id == Order.id)
        .join(Customer, Order.customer_id == Customer.id)
    )
    if status_filter:
        stmt = stmt.where(OrderItem.production_status == status_filter)
    if q:
        kw = q.strip()
        stmt = stmt.where(
            or_(
                Order.order_no.contains(kw),
                OrderItem.production_no.contains(kw),
                OrderItem.incoming_no.contains(kw),
            )
        )
    stmt = stmt.order_by(OrderItem.id.desc()).offset(skip).limit(limit)
    rows = db.execute(stmt).all()
    out: list[TaskItemOut] = []
    for item, order_no, cust_name in rows:
        base = OrderItemOut.model_validate(item).model_dump()
        out.append(TaskItemOut(**base, order_no=order_no, customer_name=cust_name))
    return out
