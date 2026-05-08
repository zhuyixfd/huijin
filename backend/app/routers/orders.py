from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, GrindLog, OrderItem
from app.models import User as UserModel
from app.order_number import generate_next_order_no
from app.order_status import format_single_line_item_order_status
from app.schemas_business import (
    CustomerOut,
    OrderCreate,
    OrderDetailOut,
    OrderGrindLogRow,
    OrderItemCreate,
    OrderListRow,
    OrderUpdate,
)
from app.schemas_business import OrderItemOut as OrderItemOutSchema

router = APIRouter()


def _detail_out(db: Session, item: OrderItem) -> OrderDetailOut:
    cust = db.get(Customer, item.customer_id)
    if cust is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    item_out = OrderItemOutSchema.model_validate(item)
    return OrderDetailOut(
        id=item.id,
        order_no=item.order_no,
        customer_id=item.customer_id,
        remark=item.order_remark,
        created_at=item.created_at,
        customer=CustomerOut.model_validate(cust),
        items=[item_out],
    )


@router.get("", response_model=list[OrderListRow])
def list_orders(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    customer_id: int | None = Query(None),
    q: str | None = Query(None, description="订单编号关键字"),
    customer_q: str | None = Query(None, description="客户名称模糊搜索"),
    status_category: str | None = Query(
        None,
        description="聚合筛选：all | placed | waiting_inbound | in_progress | completed",
    ),
    created_from: date | None = Query(None, description="下单时间起（含当日 0 点）"),
    created_to: date | None = Query(None, description="下单时间止（含当日）"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    stmt = select(OrderItem, Customer.name).join(Customer, OrderItem.customer_id == Customer.id)
    if customer_id is not None:
        stmt = stmt.where(OrderItem.customer_id == customer_id)
    if customer_q and customer_q.strip():
        stmt = stmt.where(Customer.name.contains(customer_q.strip()))
    if q:
        stmt = stmt.where(OrderItem.order_no.contains(q.strip()))
    if created_from is not None:
        start = datetime.combine(created_from, time.min)
        stmt = stmt.where(OrderItem.created_at >= start)
    if created_to is not None:
        end = datetime.combine(created_to, time.max)
        stmt = stmt.where(OrderItem.created_at <= end)

    cat = (status_category or "all").strip().lower()
    if cat not in ("", "all"):
        if cat == "placed":
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
        elif cat == "in_progress_today":
            today = date.today()
            stmt = stmt.where(
                OrderItem.production_status != "未入库",
                OrderItem.production_status != "已发回",
                or_(
                    OrderItem.incoming_date == today,
                    func.date(OrderItem.cutting_time) == today,
                ),
            )
        else:
            raise HTTPException(status_code=400, detail="无效的 status_category")

    stmt = stmt.order_by(OrderItem.id.desc()).offset(skip).limit(limit)
    rows = db.execute(stmt).all()
    out: list[OrderListRow] = []
    for item, name in rows:
        cnt = 1
        done_n = 1 if item.production_status == "已发回" else 0
        status_label = format_single_line_item_order_status(item.production_status)
        out.append(
            OrderListRow(
                id=item.id,
                order_no=item.order_no,
                customer_id=item.customer_id,
                customer_name=name,
                remark=item.order_remark,
                created_at=item.created_at,
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
    if len(body.items) != 1:
        raise HTTPException(status_code=400, detail="必须且仅能包含 1 条来料明细")
    cust = db.get(Customer, body.customer_id)
    if cust is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    it = body.items[0]
    payload = it.model_dump()

    row = None
    for _ in range(40):
        try:
            order_no = generate_next_order_no(db, customer_id=body.customer_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        row = OrderItem(
            order_no=order_no,
            customer_id=body.customer_id,
            order_remark=body.remark,
            sort_order=0,
            **payload,
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
    return _detail_out(db, row)


@router.get("/{item_id}/grind-logs", response_model=list[OrderGrindLogRow])
def list_order_grind_logs(
    item_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """某条来料订单（order_items 行）下的修磨记录。"""
    item = db.get(OrderItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    rows = db.execute(
        select(GrindLog, OrderItem.production_no, OrderItem.incoming_no)
        .join(OrderItem, GrindLog.order_item_id == OrderItem.id)
        .where(OrderItem.id == item_id)
        .order_by(GrindLog.created_at.desc())
    ).all()
    out: list[OrderGrindLogRow] = []
    for log, prod_no, inc_no in rows:
        out.append(
            OrderGrindLogRow(
                id=log.id,
                order_item_id=log.order_item_id,
                production_no=prod_no,
                incoming_no=inc_no,
                note=log.note,
                created_at=log.created_at,
            )
        )
    return out


@router.get("/{item_id}", response_model=OrderDetailOut)
def get_order(
    item_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(OrderItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    return _detail_out(db, item)


@router.patch("/{item_id}", response_model=OrderDetailOut)
def update_order(
    item_id: int,
    body: OrderUpdate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(OrderItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    data = body.model_dump(exclude_unset=True)
    if "customer_id" in data and data["customer_id"] is not None:
        if db.get(Customer, data["customer_id"]) is None:
            raise HTTPException(status_code=404, detail="客户不存在")
    if "remark" in data:
        item.order_remark = data.pop("remark")
    for k, v in data.items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return _detail_out(db, item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    item_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(OrderItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    db.delete(item)
    db.commit()
    return None
