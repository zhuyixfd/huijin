import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.constants_metal import slowest_production_status
from app.database import get_db
from app.deps import get_current_user, require_permission
from app.models import GrindLog, OrderItem, OrderItemFinishedOutput, SplitMergeLog
from app.models import User as UserModel
from app.permissions import (
    PERM_ORDER_PROCESS,
    has_permission,
    required_perm_for_batch,
    required_perm_for_item_patch,
)
from app.order_item_finished import (
    replace_finished_outputs,
    resolve_finished_outputs,
    sync_output_piece_codes_store,
)
from app.processing_codes import (
    ensure_order_item_processing_codes,
    reassign_processing_codes_batch,
    sync_processing_codes_length,
    set_all_unit_production_statuses,
    sync_unit_production_statuses_length,
)
from app.schemas_business import (
    GrindLogCreate,
    GrindLogOut,
    OrderItemBatchProductionStatus,
    OrderItemBatchProcessingCodes,
    OrderItemUnitProductionStatusesUpdate,
    OrderItemUpdate,
)
from app.schemas_business import OrderItemOut as OrderItemOutSchema

router = APIRouter()


def _clear_processing_unit_codes(db: Session, row: OrderItem) -> None:
    row.processing_unit_codes = None
    sync_output_piece_codes_store(db, row)


def _merge_allowed_status(st: str) -> bool:
    return st not in ("在库中", "已发回", "出库中")


def _is_multi_spec_family_child(row: OrderItem) -> bool:
    return (
        bool(row.split_base_order_no)
        and row.split_group_id is None
        and row.split_seq is not None
        and int(row.split_seq or 0) > 0
    )


def _is_multi_spec_family_merged_root(row: OrderItem) -> bool:
    return (
        bool(row.split_base_order_no)
        and row.split_group_id is None
        and int(row.split_seq or 0) == 0
        and row.order_no == row.split_base_order_no
    )


def _load_multi_spec_family_items(db: Session, row: OrderItem) -> list[OrderItem]:
    base = row.split_base_order_no
    if not base or row.split_group_id is not None:
        return []
    items = db.scalars(
        select(OrderItem)
        .where(
            OrderItem.customer_id == row.customer_id,
            OrderItem.split_base_order_no == base,
            OrderItem.split_group_id.is_(None),
        )
        .order_by(OrderItem.split_seq.asc(), OrderItem.id.asc())
    ).all()
    return list(items)


def _format_multi_spec_family_statuses(items: list[OrderItem]) -> str:
    if not items:
        return "同批分支订单未全部待发回"
    parts = [f"{it.order_no}: {it.production_status}" for it in items]
    return "同批订单未全部待发回，当前状态如下：\n" + "\n".join(parts)


def _finished_output_payload(fo: OrderItemFinishedOutput) -> dict:
    return {
        "spec": fo.spec,
        "pieces": fo.pieces,
        "weight_return": fo.weight_return,
        "return_date": fo.return_date,
        "remark": fo.remark,
    }


def _split_merged_multi_spec_family(
    db: Session,
    row: OrderItem,
    *,
    target_status: str,
) -> OrderItem:
    if not _is_multi_spec_family_merged_root(row):
        return row
    base_order_no = row.split_base_order_no
    if not base_order_no:
        return row
    outputs = list(
        db.scalars(
            select(OrderItemFinishedOutput)
            .where(OrderItemFinishedOutput.order_item_id == row.id)
            .order_by(OrderItemFinishedOutput.sort_order.asc(), OrderItemFinishedOutput.id.asc())
        ).all()
    )
    if len(outputs) <= 1:
        return row

    codes = list(row.processing_unit_codes or [])
    statuses = list(row.unit_production_statuses or [])
    logs = db.scalars(select(GrindLog).where(GrindLog.order_item_id == row.id)).all()
    orphan_logs = [log for log in logs if log.unit_index is None]

    cursor = 0
    for idx, fo in enumerate(outputs, start=1):
        pieces = max(1, int(fo.pieces or 1))
        unit_offset = cursor
        sub_codes = list(codes[unit_offset : unit_offset + pieces])
        sub_statuses = list(statuses[unit_offset : unit_offset + pieces])
        cursor += pieces

        order_no = f"{base_order_no}-{idx}"
        if idx == 1:
            child = row
            child.order_no = order_no
        else:
            child = OrderItem(
                order_no=order_no,
                customer_id=row.customer_id,
                order_remark=row.order_remark,
                sort_order=row.sort_order,
                incoming_no=row.incoming_no,
                material_grade=row.material_grade,
                spec_incoming=row.spec_incoming,
                weight_incoming=row.weight_incoming,
                incoming_quantity=row.incoming_quantity,
                quantity=pieces,
                weight_return=fo.weight_return,
                cut_head_weight=None,
                formed_size=row.formed_size,
                forging_requirements=row.forging_requirements,
                remark=row.remark,
                remark_images=row.remark_images,
                incoming_sheet_images=row.incoming_sheet_images,
                production_status=target_status,
                in_today_queue=False,
                in_tomorrow_queue=False,
                processing_unit_codes=sub_codes or None,
                unit_production_statuses=sub_statuses or ([target_status] * pieces),
                split_group_id=None,
                split_base_order_no=base_order_no,
                split_seq=idx,
                return_date=fo.return_date,
                incoming_date=row.incoming_date,
                cutting_time=row.cutting_time,
            )
            db.add(child)
            db.flush()

        child.split_base_order_no = base_order_no
        child.split_seq = idx
        child.split_group_id = None
        child.production_status = target_status
        child.in_today_queue = False
        child.in_tomorrow_queue = False
        child.processing_unit_codes = sub_codes or None
        child.unit_production_statuses = sub_statuses or ([target_status] * pieces)
        child.quantity = pieces
        child.weight_return = fo.weight_return
        child.return_date = fo.return_date
        child.production_status = slowest_production_status(
            list(child.unit_production_statuses or []), fallback=target_status
        )

        fo.order_item_id = child.id
        fo.sort_order = 0
        fo.piece_code = None

        for log in logs:
            if log.unit_index is None:
                continue
            if unit_offset <= int(log.unit_index) < unit_offset + pieces:
                log.order_item_id = child.id
                log.unit_index = int(log.unit_index) - unit_offset
        if idx == 1:
            for log in orphan_logs:
                log.order_item_id = child.id

        if target_status in ("在库中", "已发回"):
            child.processing_unit_codes = None
        else:
            sync_processing_codes_length(child)
            sync_unit_production_statuses_length(child)
            ensure_order_item_processing_codes(db, child)

    db.flush()
    return row


def _merge_multi_spec_family_for_outbound(
    db: Session,
    row: OrderItem,
    *,
    target_status: str,
) -> OrderItem:
    items = _load_multi_spec_family_items(db, row)
    if len(items) <= 1:
        return row
    if any(str(it.production_status or "") != "待发回" for it in items):
        raise HTTPException(status_code=409, detail=_format_multi_spec_family_statuses(items))
    base_order_no = row.split_base_order_no
    if not base_order_no:
        return row
    conflict = db.scalar(
        select(OrderItem.id).where(
            OrderItem.order_no == base_order_no,
            ~OrderItem.id.in_([it.id for it in items]),
        )
    )
    if conflict is not None:
        raise HTTPException(status_code=409, detail=f"基础订单号 {base_order_no} 已存在，无法自动合并")

    keep = items[0]
    keep.order_no = base_order_no
    keep.in_today_queue = False
    keep.in_tomorrow_queue = False
    keep.processing_unit_codes = list(keep.processing_unit_codes or [])
    keep.unit_production_statuses = list(keep.unit_production_statuses or [])
    keep.cut_head_weight = None
    keep.weight_return = None
    keep.return_date = None

    sort_order = 0
    total_qty = 0
    total_weight_return = 0
    any_weight_return = False
    total_cut_head = 0
    any_cut_head = False
    max_return_date = None

    for idx, it in enumerate(items):
        rows = db.scalars(
            select(OrderItemFinishedOutput)
            .where(OrderItemFinishedOutput.order_item_id == it.id)
            .order_by(OrderItemFinishedOutput.sort_order.asc(), OrderItemFinishedOutput.id.asc())
        ).all()
        for fo in rows:
            fo.order_item_id = keep.id
            fo.sort_order = sort_order
            sort_order += 1
            total_qty += max(1, int(fo.pieces or 1))
            if fo.weight_return is not None:
                total_weight_return += fo.weight_return
                any_weight_return = True
            if fo.return_date is not None and (max_return_date is None or fo.return_date > max_return_date):
                max_return_date = fo.return_date
        if idx != 0:
            logs = db.scalars(select(GrindLog).where(GrindLog.order_item_id == it.id)).all()
            for log in logs:
                log.order_item_id = keep.id
            keep.processing_unit_codes = list(keep.processing_unit_codes or []) + list(
                it.processing_unit_codes or []
            )
            keep.unit_production_statuses = list(keep.unit_production_statuses or []) + list(
                it.unit_production_statuses or []
            )
            db.flush()
            db.delete(it)
        if it.cut_head_weight is not None:
            total_cut_head += it.cut_head_weight
            any_cut_head = True

    keep.quantity = max(1, total_qty)
    keep.weight_return = total_weight_return if any_weight_return else None
    keep.cut_head_weight = total_cut_head if any_cut_head else None
    keep.return_date = max_return_date
    keep.production_status = target_status
    keep.unit_production_statuses = [target_status] * keep.quantity
    keep.split_base_order_no = base_order_no
    keep.split_seq = 0
    keep.split_group_id = None
    return keep


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
    keep_qty = int(keep.quantity or 0)
    drop_qty = int(drop.quantity or 0)
    keep.quantity = keep_qty + drop_qty
    keep.processing_unit_codes = list(keep.processing_unit_codes or []) + list(
        drop.processing_unit_codes or []
    )
    ka = keep.unit_production_statuses
    kb = drop.unit_production_statuses
    if isinstance(ka, list) or isinstance(kb, list):
        a = list(ka or [st] * max(1, keep_qty))
        b = list(kb or [st] * max(1, drop_qty))
        keep.unit_production_statuses = a + b
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
    keep.split_base_order_no = None
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
    db: Session,
    row: OrderItem,
    *,
    target_status: str,
) -> OrderItem:
    if target_status not in ("出库中", "已发回"):
        return row
    if _is_multi_spec_family_child(row):
        return row
    if row.split_group_id and row.split_base_order_no:
        raise HTTPException(status_code=400, detail="拆分订单未合并前，禁止进入出库/已发回")
    return row

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_REMARK_DIR = _BACKEND_ROOT / "uploads" / "order_remarks"
UPLOAD_INCOMING_SHEET_DIR = _BACKEND_ROOT / "uploads" / "incoming_sheets"
ALLOWED_SUFFIX = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_REMARK_FILES = 12
MAX_REMARK_BYTES = 8 * 1024 * 1024


def _ensure_remark_upload_dir(item_id: int) -> Path:
    d = UPLOAD_REMARK_DIR / str(item_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ensure_incoming_sheet_upload_dir(item_id: int) -> Path:
    d = UPLOAD_INCOMING_SHEET_DIR / str(item_id)
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

    from datetime import date, datetime

    now_cut = datetime.now()
    for row in items:
        old_ps = row.production_status
        if st not in ("待发回", "出库中", "已发回"):
            row = _split_merged_multi_spec_family(db, row, target_status=st)
        row = _guard_split_group_status_change(db, row, target_status=st)
        row.production_status = st
        if st == "已发回" and old_ps != "已发回":
            row.returned_at = datetime.now()
            if row.return_date is None:
                row.return_date = date.today()
        if row.unit_production_statuses is not None or int(row.quantity or 1) > 1:
            set_all_unit_production_statuses(row, st)
        if st in ("在库中", "已发回"):
            row.in_today_queue = False
            row.in_tomorrow_queue = False
            _clear_processing_unit_codes(db, row)
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
            sync_unit_production_statuses_length(row)
            ensure_order_item_processing_codes(db, row)
        _ensure_merge_after_status_change(db, row, operator_user_id=getattr(current, "id", None))
    db.commit()
    return {"updated": len(items)}


@router.patch("/{item_id}/unit-production-statuses", response_model=list[str])
def patch_unit_production_statuses(
    item_id: int,
    body: OrderItemUnitProductionStatusesUpdate,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    old_ps = row.production_status
    qty = max(1, int(row.quantity or 1))
    if body.unit_codes is not None:
        if len(body.unit_codes) != qty:
            raise HTTPException(status_code=400, detail="unit_codes 长度必须与支数一致")
        codes = [str(s).strip() for s in body.unit_codes]
        if len(set(codes)) != len(codes):
            raise HTTPException(status_code=400, detail="件号不能重复")
        row.processing_unit_codes = list(codes)
    cur = row.unit_production_statuses
    base = list(cur) if isinstance(cur, list) else [row.production_status] * qty
    if len(base) != qty:
        base = (base + [row.production_status] * qty)[:qty]
    if body.set_all is not None:
        if body.set_all in ("出库中", "已发回"):
            row = _guard_split_group_status_change(db, row, target_status=body.set_all)
            qty = max(1, int(row.quantity or 1))
            cur = row.unit_production_statuses
            base = list(cur) if isinstance(cur, list) else [row.production_status] * qty
            if len(base) != qty:
                base = (base + [row.production_status] * qty)[:qty]
        base = [body.set_all] * qty
    if body.unit_statuses is not None:
        if len(body.unit_statuses) != qty:
            raise HTTPException(status_code=400, detail="unit_statuses 长度必须与支数一致")
        base = list(body.unit_statuses)
    row.unit_production_statuses = base
    row.production_status = slowest_production_status(base, fallback=row.production_status)
    if row.production_status == "已发回" and old_ps != "已发回":
        from datetime import date, datetime

        row.returned_at = datetime.now()
        if row.return_date is None:
            row.return_date = date.today()
    if row.production_status not in ("待发回", "出库中", "已发回"):
        row = _split_merged_multi_spec_family(db, row, target_status=row.production_status)
        qty = max(1, int(row.quantity or 1))
    all_idle = all(str(s).strip() in ("在库中", "已发回") for s in base)
    if row.production_status == "已发回" or all_idle:
        _clear_processing_unit_codes(db, row)
    else:
        sync_processing_codes_length(row)
        ensure_order_item_processing_codes(db, row)
    base_order_no = row.split_base_order_no
    gid = row.split_group_id
    db.commit()
    fresh = db.get(OrderItem, row.id)
    if fresh is not None:
        db.refresh(fresh)
        row = fresh
    elif base_order_no and gid:
        merged = db.scalar(select(OrderItem).where(OrderItem.order_no == base_order_no))
        if merged is not None:
            db.refresh(merged)
            row = merged
    return list(row.unit_production_statuses or [])


@router.post("/batch-processing-codes")
def batch_reassign_processing_codes(
    body: OrderItemBatchProcessingCodes,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    ids = list(dict.fromkeys(body.item_ids))
    if not ids:
        raise HTTPException(status_code=400, detail="请至少选择一条明细")
    day = int(body.day_of_month)
    items = db.scalars(select(OrderItem).where(OrderItem.id.in_(ids))).all()
    if len(items) != len(ids):
        raise HTTPException(status_code=404, detail="未找到所选明细")
    reassign_processing_codes_batch(db, list(items), day_of_month=day)
    db.commit()
    return {"ok": True, "count": len(ids)}



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
    if st not in (None, "待发回", "出库中", "已发回"):
        row = _split_merged_multi_spec_family(db, row, target_status=st)
    if st in ("出库中", "已发回"):
        row = _guard_split_group_status_change(db, row, target_status=st)
    if st in ("在库中", "已发回"):
        row.in_today_queue = False
        row.in_tomorrow_queue = False
        data.pop("in_today_queue", None)
        data.pop("in_tomorrow_queue", None)
    had_explicit_production_status = "production_status" in data
    finished_raw = data.pop("finished_outputs", None)
    had_finished_outputs = finished_raw is not None
    piece_prefix: str | None = None
    if had_finished_outputs and isinstance(finished_raw, list):
        for x in finished_raw:
            if not isinstance(x, dict):
                continue
            pc = x.get("piece_code")
            if pc is None:
                continue
            s = str(pc).strip()
            if s:
                piece_prefix = s
                break
    for k, v in data.items():
        setattr(row, k, v)
    if had_finished_outputs:
        replace_finished_outputs(db, row, finished_raw)
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
    if row.quantity is None:
        _clear_processing_unit_codes(db, row)
        row.unit_production_statuses = None
        qty = 0
    else:
        qty = max(1, int(row.quantity or 1))
    sync_unit_production_statuses_length(row)
    raw = row.unit_production_statuses
    if isinstance(raw, list):
        base = []
        for x in raw:
            s = str(x).strip() if x is not None else ""
            base.append(s if s else row.production_status)
    else:
        base = [row.production_status] * qty
    while len(base) < qty:
        base.append(row.production_status)
    base = base[:qty]
    any_processing = any(st not in ("在库中", "已发回") for st in base)
    if qty == 0:
        _clear_processing_unit_codes(db, row)
        row.unit_production_statuses = None
    elif row.production_status == "已发回" or (row.production_status == "在库中" and not any_processing):
        _clear_processing_unit_codes(db, row)
    else:
        sync_processing_codes_length(row)
        ensure_order_item_processing_codes(db, row)
        if piece_prefix:
            import re

            base = piece_prefix.strip()
            m = re.match(r"^(.*?)-(\d+)$", base)
            if m:
                base = m.group(1)
            if re.match(r"^([A-Z]|[a-e])\d+$", base):
                row.processing_unit_codes = (
                    [base] if qty == 1 else [f"{base}-{i + 1}" for i in range(qty)]
                )
    if had_explicit_production_status and isinstance(row.unit_production_statuses, list):
        set_all_unit_production_statuses(row, row.production_status)
    if old_ps != "已发回" and row.production_status == "已发回":
        from datetime import date, datetime

        row.returned_at = datetime.now()
        if row.return_date is None:
            row.return_date = date.today()
    base_order_no = row.split_base_order_no
    gid = row.split_group_id
    _ensure_merge_after_status_change(db, row, operator_user_id=getattr(current, "id", None))
    db.commit()
    fresh = db.get(OrderItem, row.id)
    if fresh is not None:
        db.refresh(fresh)
        row = fresh
    elif base_order_no and gid:
        merged = db.scalar(select(OrderItem).where(OrderItem.order_no == base_order_no))
        if merged is not None:
            db.refresh(merged)
            row = merged
        else:
            raise HTTPException(status_code=404, detail="订单已合并或不存在")
    else:
        raise HTTPException(status_code=404, detail="订单已合并或不存在")
    out = OrderItemOutSchema.model_validate(row).model_dump()
    out["finished_outputs"] = resolve_finished_outputs(db, row)
    return OrderItemOutSchema(**out)


@router.patch("/{item_id}/sync-common")
def patch_order_item_sync_common(
    item_id: int,
    body: OrderItemUpdate,
    current: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    data = body.model_dump(exclude_unset=True)
    data.pop("finished_outputs", None)
    data.pop("production_status", None)
    data.pop("in_today_queue", None)
    data.pop("in_tomorrow_queue", None)
    data.pop("quantity", None)
    data.pop("cut_head_weight", None)
    data.pop("processing_unit_codes", None)
    data.pop("unit_production_statuses", None)
    data.pop("split_group_id", None)
    data.pop("split_base_order_no", None)
    data.pop("split_seq", None)

    allow = {
        "incoming_no",
        "material_grade",
        "spec_incoming",
        "weight_incoming",
        "incoming_quantity",
        "weight_return",
        "formed_size",
        "forging_requirements",
        "remark",
        "remark_images",
        "incoming_sheet_images",
        "promised_return_date",
        "return_date",
        "incoming_date",
        "cutting_time",
    }
    data = {k: v for k, v in data.items() if k in allow}
    if not data:
        return {"updated": 0}

    items: list[OrderItem]
    if row.split_group_id:
        items = list(
            db.scalars(
                select(OrderItem)
                .where(
                    OrderItem.customer_id == row.customer_id,
                    OrderItem.split_group_id == row.split_group_id,
                )
                .order_by(OrderItem.id.asc())
            ).all()
        )
    else:
        items = _load_multi_spec_family_items(db, row)
    if not items:
        items = [row]

    for it in items:
        for k, v in data.items():
            setattr(it, k, v)
    db.commit()
    return {"updated": len(items)}


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


@router.post("/{item_id}/incoming-sheet-images", response_model=list[str])
async def upload_order_item_incoming_sheet_images(
    item_id: int,
    files: Annotated[list[UploadFile] | None, File()] = None,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    """上传来料单图片，返回可访问的相对 URL 列表（由前端写入 incoming_sheet_images）。"""
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    upload_list = [f for f in (files or []) if getattr(f, "filename", None)]
    if not upload_list:
        raise HTTPException(status_code=400, detail="请选择图片文件")
    dest_dir = _ensure_incoming_sheet_upload_dir(item_id)
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
        saved.append(f"/uploads/incoming_sheets/{item_id}/{name}")
    return saved
