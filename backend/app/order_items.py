import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.models import GrindLog, OrderItem, SplitMergeLog
from app.models import User as UserModel
from app.permissions import (
    PERM_ORDER_PROCESS,
    has_permission,
    required_perm_for_batch,
    required_perm_for_item_patch,
)
from app.processing_codes import (
    ensure_order_item_processing_codes,
    sync_processing_codes_length,
)
from app.schemas_business import (
    GrindLogCreate,
    GrindLogOut,
    OrderItemBatchProductionStatus,
    OrderItemUpdate,
)
from app.schemas_business import OrderItemOut as OrderItemOutSchema

router = APIRouter()


def _merge_allowed_status(st: str) -> bool:
    return st not in ("在库中", "已发回", "出库中")


def _try_merge_split_group(
    db: Session,
    *,
    group_id: str | None,
    base_order_no: str | None,
    operator_user_id: int | None,
) -> None:
    if not group_id or not base_order_no:
        return
    items = db.scalars(
        select(OrderItem).where(
            OrderItem.split_group_id == group_id,
            OrderItem.split_base_order_no == base_order_no,
        )
    ).all()
    if len(items) != 2:
        return
    a, b = items[0], items[1]
    if a.production_status != b.production_status:
        return
    st = a.production_status
    if not _merge_allowed_status(st):
        return
    keep = a if (a.split_seq == 1) else b if (b.split_seq == 1) else a
    drop = b if keep is a else a
    before_a = keep.order_no
    before_b = drop.order_no
    if (
        db.scalar(
            select(OrderItem.id).where(
                OrderItem.order_no == base_order_no,
                ~OrderItem.id.in_([keep.id, drop.id]),
            )
        )
        is not None
    ):
        return

    keep.order_no = base_order_no
    keep.production_status = st
    keep.quantity = int(keep.quantity or 0) + int(drop.quantity or 0)
    keep.processing_unit_codes = list(keep.processing_unit_codes or []) + list(
        drop.processing_unit_codes or []
    )
    wa = keep.cut_head_weight or 0
    wb = drop.cut_head_weight or 0
    keep.cut_head_weight = wa + wb
    if st == "待发回":
        keep.in_today_queue = False
        keep.in_tomorrow_queue = False
    else:
        keep.in_today_queue = bool(keep.in_today_queue) or bool(drop.in_today_queue)
        keep.in_tomorrow_queue = (bool(keep.in_tomorrow_queue) or bool(drop.in_tomorrow_queue)) and not bool(
            keep.in_today_queue
        )

    keep.split_group_id = None
    keep.split_seq = None
    db.delete(drop)
    db.add(
        SplitMergeLog(
            action="merge",
            group_id=group_id,
            base_order_no=base_order_no,
            order_no_a=before_a,
            order_no_b=before_b,
            production_status=st,
            operator_user_id=operator_user_id,
        )
    )
    db.flush()


def _ensure_merge_after_status_change(
    db: Session,
    row: OrderItem,
    *,
    operator_user_id: int | None,
) -> None:
    gid = row.split_group_id
    base = row.split_base_order_no
    if not gid or not base:
        return
    _try_merge_split_group(db, group_id=gid, base_order_no=base, operator_user_id=operator_user_id)


def _guard_split_group_status_change(
    row: OrderItem,
    *,
    target_status: str,
) -> None:
    if target_status not in ("出库中", "已发回"):
        return
    if row.split_group_id and row.split_base_order_no:
        raise HTTPException(status_code=400, detail="拆分订单未合并前，禁止进入出库/已发回")

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_REMARK_DIR = _BACKEND_ROOT / "uploads" / "order_remarks"
ALLOWED_SUFFIX = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_REMARK_FILES = 12
MAX_REMARK_BYTES = 8 * 1024 * 1024


def _ensure_remark_upload_dir(item_id: int) -> Path:
    d = UPLOAD_REMARK_DIR / str(item_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_suffix(filename: str) -> str:
    suf = Path(filename).suffix.lower()
    return suf if suf in ALLOWED_SUFFIX else ".bin"


@router.post("/batch-production-status")
def batch_set_production_status(
    body: OrderItemBatchProductionStatus,
    current: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ids = list(dict.fromkeys(body.item_ids))
    if not ids:
        raise HTTPException(status_code=400, detail="请至少选择一条明细")
    st = body.production_status
    items = db.scalars(select(OrderItem).where(OrderItem.id.in_(ids))).all()
    if len(items) != len(ids):
        raise HTTPException(status_code=404, detail="未找到所选明细")
    need = required_perm_for_batch(items, st)
    if not has_permission(current, need):
        raise HTTPException(status_code=403, detail="无权限执行该批量状态变更")

    from datetime import datetime

    now_cut = datetime.now()
    for row in items:
        _guard_split_group_status_change(row, target_status=st)
        row.production_status = st
        if st in ("在库中", "已发回"):
            row.in_today_queue = False
            row.in_tomorrow_queue = False
            row.processing_unit_codes = None
        elif body.in_today_queue is not None:
            row.in_today_queue = bool(body.in_today_queue)
            if row.in_today_queue:
                row.in_tomorrow_queue = False
        if body.in_tomorrow_queue is not None:
            row.in_tomorrow_queue = bool(body.in_tomorrow_queue)
            if row.in_tomorrow_queue:
                row.in_today_queue = False
        if st == "锻造中" and body.in_today_queue is True and row.cutting_time is None:
            row.cutting_time = now_cut
        if st not in ("在库中", "已发回"):
            sync_processing_codes_length(row)
            ensure_order_item_processing_codes(db, row)
        _ensure_merge_after_status_change(db, row, operator_user_id=getattr(current, "id", None))
    db.commit()
    return {"updated": len(items)}


@router.patch("/{item_id}", response_model=OrderItemOutSchema)
def patch_order_item(
    item_id: int,
    body: OrderItemUpdate,
    current: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    data = body.model_dump(exclude_unset=True)
    need = required_perm_for_item_patch(row, data)
    if not has_permission(current, need):
        raise HTTPException(status_code=403, detail="无权限修改该明细")

    old_ps = row.production_status
    st = data.get("production_status")
    if st in ("出库中", "已发回"):
        _guard_split_group_status_change(row, target_status=st)
    if st in ("在库中", "已发回"):
        row.in_today_queue = False
        row.in_tomorrow_queue = False
        data.pop("in_today_queue", None)
        data.pop("in_tomorrow_queue", None)
    had_explicit_production_status = "production_status" in data
    for k, v in data.items():
        setattr(row, k, v)
    # 列入今日处理且未指定状态时：仅将「在库中」视为待下车间，默认锻造中（避免覆盖修磨中等工序）
    if data.get("in_today_queue") is True and not had_explicit_production_status:
        if row.production_status in ("在库中",):
            row.production_status = "锻造中"
    if data.get("in_tomorrow_queue") is True and not had_explicit_production_status:
        if row.production_status in ("在库中",):
            row.production_status = "锻造中"
    if data.get("in_today_queue") is True:
        row.in_tomorrow_queue = False
    if data.get("in_tomorrow_queue") is True:
        row.in_today_queue = False
    if (
        old_ps != "锻造中"
        and row.production_status == "锻造中"
        and row.cutting_time is None
        and "cutting_time" not in data
    ):
        from datetime import datetime

        row.cutting_time = datetime.now()
    if row.production_status in ("在库中", "已发回"):
        row.processing_unit_codes = None
    else:
        sync_processing_codes_length(row)
        ensure_order_item_processing_codes(db, row)
    base_order_no = row.split_base_order_no
    gid = row.split_group_id
    _ensure_merge_after_status_change(db, row, operator_user_id=getattr(current, "id", None))
    db.commit()
    fresh = db.get(OrderItem, row.id)
    if fresh is not None:
        db.refresh(fresh)
        return fresh
    if base_order_no and gid:
        merged = db.scalar(select(OrderItem).where(OrderItem.order_no == base_order_no))
        if merged is not None:
            db.refresh(merged)
            return merged
    raise HTTPException(status_code=404, detail="订单已合并或不存在")


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order_item(
    item_id: int,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
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
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
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


@router.post("/{item_id}/remark-images", response_model=list[str])
async def upload_order_item_remark_images(
    item_id: int,
    files: Annotated[list[UploadFile] | None, File()] = None,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    """上传备注配图，返回可访问的相对 URL 列表（由前端写入 remark_images）。"""
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    upload_list = [f for f in (files or []) if getattr(f, "filename", None)]
    if not upload_list:
        raise HTTPException(status_code=400, detail="请选择图片文件")
    dest_dir = _ensure_remark_upload_dir(item_id)
    saved: list[str] = []
    for uf in upload_list[:MAX_REMARK_FILES]:
        if not uf.filename:
            continue
        raw = await uf.read()
        if len(raw) > MAX_REMARK_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"单文件过大（>{MAX_REMARK_BYTES // 1024 // 1024}MB）",
            )
        ext = _safe_suffix(uf.filename)
        name = f"{uuid.uuid4().hex}{ext}"
        (dest_dir / name).write_bytes(raw)
        saved.append(f"/uploads/order_remarks/{item_id}/{name}")
    return saved
