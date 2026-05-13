from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
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
from app.processing_codes import (
    ensure_order_item_processing_codes,
    sync_processing_codes_length,
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
    items = db.scalars(select(OrderItem).where(OrderItem.id.in_(ids))).all()
    if len(items) != len(ids):
        raise HTTPException(status_code=404, detail="未找到所选明细")
    now_cut = datetime.now()
    for row in items:
        row.production_status = st
        if st in ("未入库", "已发回"):
            row.in_today_queue = False
            row.processing_unit_codes = None
        elif body.in_today_queue is not None:
            row.in_today_queue = bool(body.in_today_queue)
        if st == "锻造中" and body.in_today_queue is True and row.cutting_time is None:
            row.cutting_time = now_cut
        if st not in ("未入库", "已发回"):
            sync_processing_codes_length(row)
            ensure_order_item_processing_codes(db, row)
    db.commit()
    return {"updated": len(items)}


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
    old_ps = row.production_status
    st = data.get("production_status")
    if st in ("未入库", "已发回"):
        row.in_today_queue = False
        data.pop("in_today_queue", None)
    had_explicit_production_status = "production_status" in data
    for k, v in data.items():
        setattr(row, k, v)
    # 列入今日处理且未指定状态时：仅将「已入库/未入库」视为待下车间，默认锻造中（避免覆盖修磨中等工序）
    if data.get("in_today_queue") is True and not had_explicit_production_status:
        if row.production_status in ("已入库", "未入库"):
            row.production_status = "锻造中"
    if (
        old_ps != "锻造中"
        and row.production_status == "锻造中"
        and row.cutting_time is None
        and "cutting_time" not in data
    ):
        row.cutting_time = datetime.now()
    if row.production_status in ("未入库", "已发回"):
        row.processing_unit_codes = None
    else:
        sync_processing_codes_length(row)
        ensure_order_item_processing_codes(db, row)
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
    log = GrindLog(
        order_item_id=item_id,
        note=body.note,
        unit_index=body.unit_index,
    )
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
