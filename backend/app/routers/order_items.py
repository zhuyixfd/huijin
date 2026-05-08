from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import GrindLog, OrderItem
from app.models import User as UserModel
from app.schemas_business import (
    GrindLogCreate,
    GrindLogOut,
    OrderItemBatchProductionStatus,
    OrderItemUpdate,
)
from app.schemas_business import OrderItemOut as OrderItemOutSchema

router = APIRouter()


@router.post("/batch-production-status")
def batch_set_production_status(
    body: OrderItemBatchProductionStatus,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ids = list(dict.fromkeys(body.item_ids))
    if not ids:
        raise HTTPException(status_code=400, detail="请至少选择一条明细")
    st = body.production_status
    result = db.execute(
        update(OrderItem)
        .where(OrderItem.id.in_(ids))
        .values(production_status=st)
    )
    db.commit()
    n = int(result.rowcount or 0)
    if n == 0:
        raise HTTPException(status_code=404, detail="未找到所选明细")
    return {"updated": n}


@router.patch("/{item_id}", response_model=OrderItemOutSchema)
def patch_order_item(
    item_id: int,
    body: OrderItemUpdate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    data = body.model_dump(exclude_unset=True)
    st = data.get("production_status")
    if st in ("未入库", "已发回"):
        row.in_today_queue = False
        data.pop("in_today_queue", None)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order_item(
    item_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    db.delete(row)
    db.commit()
    return None


@router.post(
    "/{item_id}/grind-logs",
    response_model=GrindLogOut,
    status_code=status.HTTP_201_CREATED,
)
def add_grind_log(
    item_id: int,
    body: GrindLogCreate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    log = GrindLog(order_item_id=item_id, note=body.note)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/{item_id}/grind-logs", response_model=list[GrindLogOut])
def list_grind_logs(
    item_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.get(OrderItem, item_id) is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    logs = db.scalars(
        select(GrindLog)
        .where(GrindLog.order_item_id == item_id)
        .order_by(GrindLog.created_at.desc())
    ).all()
    return list(logs)
