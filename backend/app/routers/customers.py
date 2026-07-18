from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, OrderItem, OrderItemFinishedOutput
from app.models import User as UserModel
from app.order_item_finished import load_finished_outputs_map, resolve_finished_outputs
from app.order_status import format_single_line_item_order_status
from app.schemas_business import (
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
    OrderItemOut,
    TaskItemListOut,
    TaskItemOut,
)

router = APIRouter()


@router.get("", response_model=list[CustomerOut])
def list_customers(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="按名称模糊搜索"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    stmt = select(Customer).order_by(Customer.id.desc())
    if q:
        stmt = stmt.where(Customer.name.contains(q.strip()))
    stmt = stmt.offset(skip).limit(limit)
    return list(db.scalars(stmt).all())


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
def create_customer(
    body: CustomerCreate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = Customer(
        name=body.name.strip(),
        abbr=body.abbr,
        contact_name=body.contact_name,
        phone=body.phone,
        address=body.address,
        remark=body.remark,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="客户缩写已存在",
        ) from None
    db.refresh(row)
    return row


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    return row


@router.get("/{customer_id}/monthly-io-items", response_model=TaskItemListOut)
def list_customer_monthly_io_items(
    customer_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    year: int = Query(..., ge=2000, le=2100, description="年份"),
    month: int = Query(..., ge=1, le=12, description="月份 1–12"),
):
    """按月导出出入明细：来料日期或送回日期落在该月的订单明细。"""
    cust = db.get(Customer, customer_id)
    if cust is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    fo_in_month = exists(
        select(OrderItemFinishedOutput.id).where(
            OrderItemFinishedOutput.order_item_id == OrderItem.id,
            OrderItemFinishedOutput.return_date >= start,
            OrderItemFinishedOutput.return_date <= end,
        )
    )
    conds = [
        OrderItem.customer_id == customer_id,
        or_(
            and_(OrderItem.incoming_date >= start, OrderItem.incoming_date <= end),
            and_(OrderItem.return_date >= start, OrderItem.return_date <= end),
            fo_in_month,
        ),
    ]

    count_stmt = select(func.count(OrderItem.id)).where(*conds)
    total = int(db.scalar(count_stmt) or 0)
    rows = list(
        db.scalars(
            select(OrderItem)
            .where(*conds)
            .order_by(OrderItem.incoming_date.asc(), OrderItem.id.asc())
        ).all()
    )
    item_ids = [item.id for item in rows]
    items_by_id = {item.id: item for item in rows}
    outputs_map = load_finished_outputs_map(db, item_ids, items_by_id)
    cust_name = cust.name

    out: list[TaskItemOut] = []
    for item in rows:
        base = OrderItemOut.model_validate(item).model_dump()
        fo = outputs_map.get(item.id)
        if fo is None:
            fo = resolve_finished_outputs(db, item)
        base["finished_outputs"] = fo
        out.append(
            TaskItemOut(
                **base,
                customer_name=cust_name,
                order_created_at=item.created_at,
                order_status=format_single_line_item_order_status(item.production_status),
            )
        )
    return TaskItemListOut(items=out, total=total)


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
    for k, v in data.items():
        setattr(row, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="客户缩写已存在",
        ) from None
    db.refresh(row)
    return row


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    cnt = db.scalar(
        select(func.count()).select_from(OrderItem).where(OrderItem.customer_id == customer_id)
    )
    if cnt and cnt > 0:
        raise HTTPException(status_code=400, detail="该客户下已有订单，无法删除")
    db.delete(row)
    db.commit()
    return None
