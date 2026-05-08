from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, Order, OrderItem
from app.models import User as UserModel
from app.order_number import generate_next_order_no
from app.order_status import format_order_status_display
from app.schemas_business import OrderItemCreate, OrderItemOut, TaskItemOut, WorkOrderCreate

router = APIRouter()


def _item_from_create(body: OrderItemCreate, order_id: int, sort_order: int) -> OrderItem:
    d = body.model_dump()
    return OrderItem(order_id=order_id, sort_order=sort_order, **d)


def _single_row_order_status(item: OrderItem) -> str:
    cnt = 1
    done_n = 1 if item.production_status == "已发回" else 0
    wait_n = 1 if item.production_status == "未入库" else 0
    return format_order_status_display(cnt, done_n, wait_n)


@router.get("/items", response_model=list[TaskItemOut])
def list_task_items(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None, description="生产编号/来料编号/订单号"),
    customer_id: int | None = Query(None),
    customer_q: str | None = Query(None, description="客户名称模糊"),
    status_category: str | None = Query(
        None,
        description="聚合筛选：all | placed | waiting_inbound | in_progress | completed",
    ),
    created_from: date | None = Query(None),
    created_to: date | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    stmt = (
        select(OrderItem, Order.order_no, Customer.name, Order.remark, Order.created_at)
        .join(Order, OrderItem.order_id == Order.id)
        .join(Customer, Order.customer_id == Customer.id)
    )
    if status_filter:
        stmt = stmt.where(OrderItem.production_status == status_filter)
    if customer_id is not None:
        stmt = stmt.where(Order.customer_id == customer_id)
    if customer_q and customer_q.strip():
        stmt = stmt.where(Customer.name.contains(customer_q.strip()))
    if q:
        kw = q.strip()
        stmt = stmt.where(
            or_(
                Order.order_no.contains(kw),
                OrderItem.production_no.contains(kw),
                OrderItem.incoming_no.contains(kw),
            )
        )
    if created_from is not None:
        start = datetime.combine(created_from, time.min)
        stmt = stmt.where(Order.created_at >= start)
    if created_to is not None:
        end = datetime.combine(created_to, time.max)
        stmt = stmt.where(Order.created_at <= end)

    cat = (status_category or "all").strip().lower()
    if cat not in ("", "all"):
        if cat == "placed":
            # 任务列表以明细为主，无明细的空单不出现在此；占位兼容前端筛选
            stmt = stmt.where(OrderItem.id == -1)
        elif cat == "waiting_inbound":
            stmt = stmt.where(OrderItem.production_status == "未入库")
        elif cat == "completed":
            stmt = stmt.where(OrderItem.production_status == "已发回")
        elif cat == "in_progress":
            stmt = stmt.where(
                OrderItem.production_status != "未入库",
                OrderItem.production_status != "已发回",
            )
        else:
            raise HTTPException(status_code=400, detail="无效的 status_category")

    stmt = stmt.order_by(OrderItem.id.desc()).offset(skip).limit(limit)
    rows = db.execute(stmt).all()
    out: list[TaskItemOut] = []
    for item, order_no, cust_name, order_remark, created_at in rows:
        base = OrderItemOut.model_validate(item).model_dump()
        out.append(
            TaskItemOut(
                **base,
                order_no=order_no,
                customer_name=cust_name,
                order_remark=order_remark,
                order_created_at=created_at,
                order_status=_single_row_order_status(item),
            )
        )
    return out


@router.post("/work-orders", response_model=TaskItemOut, status_code=status.HTTP_201_CREATED)
def create_work_order(
    body: WorkOrderCreate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """新建一单一条来料（订单 + 唯一明细）。"""
    if db.get(Customer, body.customer_id) is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    payload = body.model_dump()
    cust_id = payload.pop("customer_id")
    order_remark = payload.pop("order_remark", None)
    item_create = OrderItemCreate(**payload)

    order_no = generate_next_order_no(db)
    order = Order(order_no=order_no, customer_id=cust_id, remark=order_remark)
    db.add(order)
    db.flush()
    db.add(_item_from_create(item_create, order.id, 0))
    db.commit()

    row = db.scalars(
        select(OrderItem).where(OrderItem.order_id == order.id).limit(1)
    ).first()
    assert row is not None
    cust = db.get(Customer, cust_id)
    assert cust is not None
    return TaskItemOut(
        **OrderItemOut.model_validate(row).model_dump(),
        order_no=order.order_no,
        customer_name=cust.name,
        order_remark=order.remark,
        order_created_at=order.created_at,
        order_status=_single_row_order_status(row),
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_item(
    item_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除该来料行并删除所属订单（一单一条）。"""
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    oid = row.order_id
    db.delete(row)
    db.flush()
    remaining = db.scalar(select(func.count(OrderItem.id)).where(OrderItem.order_id == oid)) or 0
    if remaining == 0:
        order = db.get(Order, oid)
        if order is not None:
            db.delete(order)
    db.commit()
    return None
