from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, Order, OrderItem
from app.order_number import generate_next_order_no
from app.order_status import format_order_status_display
from app.models import User as UserModel
from app.schemas_business import (
    OrderCreate,
    OrderDetailOut,
    OrderItemCreate,
    OrderListRow,
    OrderUpdate,
    ReorderItemsBody,
)
from app.schemas_business import OrderItemOut as OrderItemOutSchema

router = APIRouter()


def _item_from_create(body: OrderItemCreate, order_id: int, sort_order: int) -> OrderItem:
    d = body.model_dump()
    return OrderItem(order_id=order_id, sort_order=sort_order, **d)


@router.get("", response_model=list[OrderListRow])
def list_orders(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    customer_id: int | None = Query(None),
    q: str | None = Query(None, description="订单编号关键字"),
    customer_q: str | None = Query(None, description="客户名称模糊搜索"),
    status_category: str | None = Query(
        None,
        description="订单聚合状态：all | placed | waiting_inbound | in_progress | completed",
    ),
    created_from: date | None = Query(None, description="下单时间起（含当日 0 点）"),
    created_to: date | None = Query(None, description="下单时间止（含当日）"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    stmt = select(Order, Customer.name).join(Customer)
    if customer_id is not None:
        stmt = stmt.where(Order.customer_id == customer_id)
    if customer_q and customer_q.strip():
        stmt = stmt.where(Customer.name.contains(customer_q.strip()))
    if q:
        stmt = stmt.where(Order.order_no.contains(q.strip()))
    if created_from is not None:
        start = datetime.combine(created_from, time.min)
        stmt = stmt.where(Order.created_at >= start)
    if created_to is not None:
        end = datetime.combine(created_to, time.max)
        stmt = stmt.where(Order.created_at <= end)

    cat = (status_category or "all").strip().lower()
    if cat not in ("", "all"):
        # 与 format_order_status_display 分组一致
        if cat == "placed":
            stmt = stmt.where(~exists(select(OrderItem.id).where(OrderItem.order_id == Order.id)))
        elif cat == "waiting_inbound":
            stmt = stmt.where(
                exists(
                    select(OrderItem.id).where(
                        OrderItem.order_id == Order.id,
                        OrderItem.production_status == "未入库",
                    )
                )
            )
        elif cat == "completed":
            stmt = stmt.where(
                exists(select(OrderItem.id).where(OrderItem.order_id == Order.id)),
                ~exists(
                    select(OrderItem.id).where(
                        OrderItem.order_id == Order.id,
                        OrderItem.production_status != "已发回",
                    )
                ),
            )
        elif cat == "in_progress":
            stmt = stmt.where(
                exists(select(OrderItem.id).where(OrderItem.order_id == Order.id)),
                ~exists(
                    select(OrderItem.id).where(
                        OrderItem.order_id == Order.id,
                        OrderItem.production_status == "未入库",
                    )
                ),
                exists(
                    select(OrderItem.id).where(
                        OrderItem.order_id == Order.id,
                        OrderItem.production_status != "已发回",
                    )
                ),
            )
        else:
            raise HTTPException(status_code=400, detail="无效的 status_category")

    stmt = stmt.order_by(Order.id.desc()).offset(skip).limit(limit)
    rows = db.execute(stmt).all()
    if not rows:
        return []

    ids = [o.id for o, _ in rows]
    agg_rows = db.execute(
        select(
            OrderItem.order_id,
            func.count(OrderItem.id),
            func.sum(case((OrderItem.production_status == "已发回", 1), else_=0)),
            func.sum(case((OrderItem.production_status == "未入库", 1), else_=0)),
        )
        .where(OrderItem.order_id.in_(ids))
        .group_by(OrderItem.order_id)
    ).all()
    stats: dict[int, tuple[int, int, int]] = {}
    for oid, cnt, done_sum, wait_sum in agg_rows:
        stats[int(oid)] = (
            int(cnt),
            int(done_sum or 0),
            int(wait_sum or 0),
        )

    out: list[OrderListRow] = []
    for o, name in rows:
        cnt, done_n, wait_n = stats.get(o.id, (0, 0, 0))
        status_label = format_order_status_display(cnt, done_n, wait_n)
        out.append(
            OrderListRow(
                id=o.id,
                order_no=o.order_no,
                customer_id=o.customer_id,
                customer_name=name,
                remark=o.remark,
                created_at=o.created_at,
                order_status=status_label,
                item_count=cnt,
                item_done_count=done_n,
            )
        )
    return out


@router.post("", response_model=OrderDetailOut, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderCreate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cust = db.get(Customer, body.customer_id)
    if cust is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    order = None
    for _ in range(40):
        order_no = generate_next_order_no(db)
        order = Order(order_no=order_no, customer_id=body.customer_id, remark=body.remark)
        db.add(order)
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
            order = None
            continue
    if order is None:
        raise HTTPException(status_code=500, detail="无法生成唯一订单编号，请重试")

    for i, it in enumerate(body.items):
        db.add(_item_from_create(it, order.id, i))

    db.commit()
    db.refresh(order)
    oid = order.id
    full = db.scalar(
        select(Order)
        .options(joinedload(Order.customer), joinedload(Order.items))
        .where(Order.id == oid)
    )
    assert full is not None
    return OrderDetailOut.model_validate(full)


@router.get("/{order_id}", response_model=OrderDetailOut)
def get_order(
    order_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.scalar(
        select(Order)
        .options(joinedload(Order.customer), joinedload(Order.items))
        .where(Order.id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    return OrderDetailOut.model_validate(order)


@router.patch("/{order_id}", response_model=OrderDetailOut)
def update_order(
    order_id: int,
    body: OrderUpdate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    data = body.model_dump(exclude_unset=True)
    if "customer_id" in data and data["customer_id"] is not None:
        if db.get(Customer, data["customer_id"]) is None:
            raise HTTPException(status_code=404, detail="客户不存在")
    for k, v in data.items():
        setattr(order, k, v)
    db.commit()
    db.refresh(order)
    full = db.scalar(
        select(Order)
        .options(joinedload(Order.customer), joinedload(Order.items))
        .where(Order.id == order_id)
    )
    assert full is not None
    return OrderDetailOut.model_validate(full)


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    db.delete(order)
    db.commit()
    return None


@router.post("/{order_id}/items", response_model=OrderItemOutSchema, status_code=status.HTTP_201_CREATED)
def add_order_item(
    order_id: int,
    body: OrderItemCreate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    max_sort = db.scalar(
        select(func.max(OrderItem.sort_order)).where(OrderItem.order_id == order_id)
    )
    next_order = (max_sort if max_sort is not None else -1) + 1
    row = _item_from_create(body, order_id, next_order)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/{order_id}/reorder-items", response_model=OrderDetailOut)
def reorder_items(
    order_id: int,
    body: ReorderItemsBody,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """按传入 id 顺序重写 sort_order"""
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    existing = db.scalars(
        select(OrderItem).where(OrderItem.order_id == order_id)
    ).all()
    id_set = {r.id for r in existing}
    item_ids = body.item_ids
    if set(item_ids) != id_set:
        raise HTTPException(status_code=400, detail="明细 id 列表与订单不一致")
    for i, iid in enumerate(item_ids):
        row = db.get(OrderItem, iid)
        if row:
            row.sort_order = i
    db.commit()
    full = db.scalar(
        select(Order)
        .options(joinedload(Order.customer), joinedload(Order.items))
        .where(Order.id == order_id)
    )
    assert full is not None
    return OrderDetailOut.model_validate(full)
