from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, OrderItem
from app.models import User as UserModel
from app.order_number import generate_next_order_no
from app.order_status import format_order_status_display
from app.schemas_business import OrderItemCreate, OrderItemOut, TaskItemOut, WorkOrderCreate

router = APIRouter()


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
        select(OrderItem, Customer.name)
        .join(Customer, OrderItem.customer_id == Customer.id)
    )
    if status_filter:
        stmt = stmt.where(OrderItem.production_status == status_filter)
    if customer_id is not None:
        stmt = stmt.where(OrderItem.customer_id == customer_id)
    if customer_q and customer_q.strip():
        stmt = stmt.where(Customer.name.contains(customer_q.strip()))
    if q:
        kw = q.strip()
        stmt = stmt.where(
            or_(
                OrderItem.order_no.contains(kw),
                OrderItem.production_no.contains(kw),
                OrderItem.incoming_no.contains(kw),
            )
        )
    if created_from is not None:
        start = datetime.combine(created_from, time.min)
        stmt = stmt.where(OrderItem.created_at >= start)
    if created_to is not None:
        end = datetime.combine(created_to, time.max)
        stmt = stmt.where(OrderItem.created_at <= end)

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
    for item, cust_name in rows:
        base = OrderItemOut.model_validate(item).model_dump()
        out.append(
            TaskItemOut(
                **base,
                customer_name=cust_name,
                order_created_at=item.created_at,
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
    """新建一单一条来料（单行 order_items）。"""
    if db.get(Customer, body.customer_id) is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    payload = body.model_dump()
    cust_id = payload.pop("customer_id")
    order_remark = payload.pop("order_remark", None)
    item_fields = OrderItemCreate(**payload).model_dump()

    row = None
    for _ in range(40):
        order_no = generate_next_order_no(db)
        row = OrderItem(
            order_no=order_no,
            customer_id=cust_id,
            order_remark=order_remark,
            sort_order=0,
            **item_fields,
        )
        db.add(row)
        try:
            db.commit()
            db.refresh(row)
            break
        except IntegrityError:
            db.rollback()
            row = None
            continue
    if row is None:
        raise HTTPException(status_code=500, detail="无法生成唯一订单编号，请重试")

    cust = db.get(Customer, cust_id)
    assert cust is not None
    return TaskItemOut(
        **OrderItemOut.model_validate(row).model_dump(),
        customer_name=cust.name,
        order_created_at=row.created_at,
        order_status=_single_row_order_status(row),
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_item(
    item_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除该来料订单行（一单一行）。"""
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    db.delete(row)
    db.commit()
    return None
