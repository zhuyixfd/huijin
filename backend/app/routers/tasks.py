from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.permissions import PERM_ORDER_CREATE, PERM_ORDER_PROCESS
from app.models import CaseStudy, Customer, CutHeadLog, OrderItem, SplitMergeLog, User
from app.models import User as UserModel
from app.order_number import generate_next_order_no
from app.processing_codes import count_processing_piece_strip, ensure_processing_codes_batch
from app.order_status import format_single_line_item_order_status
from app.schemas_business import (
    CutHeadLogCreate,
    CutHeadLogListOut,
    CutHeadLogRow,
    OrderItemCreate,
    OrderItemOut,
    ProcessingLetterPieceCount,
    SplitMergeLogListOut,
    SplitMergeLogRow,
    SplitOrderBody,
    SplitOrderOut,
    TaskItemListOut,
    TaskItemOut,
    TaskNavCountsOut,
    WorkOrderCreate,
)

from app.order_item_finished import (
    load_finished_outputs_map,
    replace_finished_outputs,
    resolve_finished_outputs,
)
from app.processing_codes import ensure_order_item_processing_codes, sync_processing_codes_length

router = APIRouter()


def _quant_3(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _is_processing_status(st: str) -> bool:
    return st not in ("在库中", "已发回", "待发回", "出库中")


def _merge_allowed_status(st: str) -> bool:
    return st not in ("在库中", "已发回", "出库中")


def _single_row_order_status(item: OrderItem) -> str:
    return format_single_line_item_order_status(item.production_status)


def _task_filter_conditions(
    *,
    status_filter: str | None,
    customer_id: int | None,
    customer_q: str | None,
    q: str | None,
    status_category: str | None,
    created_from: date | None,
    created_to: date | None,
    exclude_completed: bool = False,
) -> list:
    conds: list = []
    if exclude_completed:
        conds.append(OrderItem.production_status != "已发回")
    if status_filter:
        conds.append(OrderItem.production_status == status_filter)
    if customer_id is not None:
        conds.append(OrderItem.customer_id == customer_id)
    if customer_q and customer_q.strip():
        conds.append(Customer.name.contains(customer_q.strip()))
    if q:
        kw = q.strip()
        conds.append(
            or_(
                OrderItem.order_no.contains(kw),
                OrderItem.incoming_no.contains(kw),
            )
        )
    if created_from is not None:
        start = datetime.combine(created_from, time.min)
        conds.append(OrderItem.created_at >= start)
    if created_to is not None:
        end = datetime.combine(created_to, time.max)
        conds.append(OrderItem.created_at <= end)

    cat = (status_category or "all").strip().lower()
    if cat not in ("", "all"):
        if cat == "placed":
            conds.append(OrderItem.id == -1)
        elif cat == "waiting_inbound":
            conds.append(
                or_(
                    OrderItem.production_status == "在库中",
                )
            )
        elif cat == "completed":
            conds.append(OrderItem.production_status == "已发回")
        elif cat == "in_progress":
            conds.append(OrderItem.production_status != "在库中")
            conds.append(OrderItem.production_status != "已发回")
            conds.append(OrderItem.production_status != "待发回")
            conds.append(OrderItem.production_status != "出库中")
        elif cat == "ready_outbound":
            conds.append(
                or_(
                    OrderItem.production_status == "待发回",
                    OrderItem.production_status == "出库中",
                )
            )
        else:
            raise HTTPException(status_code=400, detail="无效的 status_category")

    return conds


@router.get("/nav-counts", response_model=TaskNavCountsOut)
def task_nav_counts(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """侧栏「全部订单 / 未处理 / …」数量（全库汇总，不含列表搜索框条件）。"""
    pending_n = db.scalar(
        select(func.count(OrderItem.id)).where(
            or_(
                OrderItem.production_status == "在库中",
            )
        )
    ) or 0
    processing_n = db.scalar(
        select(func.count(OrderItem.id)).where(
            OrderItem.production_status != "在库中",
            OrderItem.production_status != "已发回",
            OrderItem.production_status != "待发回",
            OrderItem.production_status != "出库中",
        )
    ) or 0
    ready_n = db.scalar(
        select(func.count(OrderItem.id)).where(
            or_(
                OrderItem.production_status == "待发回",
                OrderItem.production_status == "出库中",
            )
        )
    ) or 0
    # 全部订单（未完成）= 未处理 + 处理中 + 待出库（三者互斥）
    all_n = int(pending_n) + int(processing_n) + int(ready_n)
    done_n = db.scalar(
        select(func.count(OrderItem.id)).where(OrderItem.production_status == "已发回")
    ) or 0
    cut_head_n = db.scalar(select(func.count(CutHeadLog.id))) or 0
    strip_tuples = count_processing_piece_strip(db)
    piece_strip = [
        ProcessingLetterPieceCount(letter=letter, count=cnt) for letter, cnt in strip_tuples
    ]
    return TaskNavCountsOut(
        all=int(all_n),
        pending=int(pending_n),
        processing=int(processing_n),
        cut_head=int(cut_head_n),
        ready_outbound=int(ready_n),
        done=int(done_n),
        processing_piece_strip=piece_strip,
    )


@router.get("/items", response_model=TaskItemListOut)
def list_task_items(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None, description="来料编号/订单号"),
    customer_id: int | None = Query(None),
    customer_q: str | None = Query(None, description="客户名称模糊"),
    status_category: str | None = Query(
        None,
        description="聚合筛选：all | placed | waiting_inbound | in_progress | completed | ready_outbound",
    ),
    created_from: date | None = Query(None),
    created_to: date | None = Query(None),
    exclude_completed: bool = Query(
        False,
        description="为 True 时排除生产状态「已发回」（用于全部订单列表）",
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    conds = _task_filter_conditions(
        status_filter=status_filter,
        customer_id=customer_id,
        customer_q=customer_q,
        q=q,
        status_category=status_category,
        created_from=created_from,
        created_to=created_to,
        exclude_completed=exclude_completed,
    )

    count_stmt = (
        select(func.count(OrderItem.id))
        .join(Customer, OrderItem.customer_id == Customer.id)
        .where(*conds)
    )
    total = int(db.scalar(count_stmt) or 0)

    stmt = (
        select(OrderItem, Customer.name)
        .join(Customer, OrderItem.customer_id == Customer.id)
        .where(*conds)
        .order_by(OrderItem.id.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    item_ids = [item.id for item, _ in rows]
    case_total: dict[int, int] = {}
    case_by_unit: dict[int, dict[str, int]] = {}
    if item_ids:
        agg = db.execute(
            select(CaseStudy.order_item_id, CaseStudy.unit_index, func.count(CaseStudy.id))
            .where(CaseStudy.order_item_id.in_(item_ids))
            .group_by(CaseStudy.order_item_id, CaseStudy.unit_index)
        ).all()
        for oid, uidx, cnt in agg:
            oid = int(oid)
            n = int(cnt)
            case_total[oid] = case_total.get(oid, 0) + n
            uk = "0" if uidx is None else str(int(uidx))
            inner = case_by_unit.setdefault(oid, {})
            inner[uk] = inner.get(uk, 0) + n

    proc_items = [
        item
        for item, _ in rows
        if item.production_status not in ("在库中", "已发回")
    ]
    if proc_items:
        ensure_processing_codes_batch(db, proc_items)
        db.commit()
        for item in proc_items:
            db.refresh(item)

    items_by_id = {item.id: item for item, _ in rows}
    outputs_map = load_finished_outputs_map(db, item_ids, items_by_id)

    out: list[TaskItemOut] = []
    for item, cust_name in rows:
        base = OrderItemOut.model_validate(item).model_dump()
        oid = item.id
        fo = outputs_map.get(oid)
        if fo is None:
            fo = resolve_finished_outputs(db, item)
        base["finished_outputs"] = fo
        out.append(
            TaskItemOut(
                **base,
                customer_name=cust_name,
                order_created_at=item.created_at,
                order_status=_single_row_order_status(item),
                case_study_count=case_total.get(oid, 0),
                case_study_by_unit=dict(case_by_unit.get(oid, {})),
            )
        )
    return TaskItemListOut(items=out, total=total)


@router.post("/work-orders", response_model=TaskItemOut, status_code=status.HTTP_201_CREATED)
def create_work_order(
    body: WorkOrderCreate,
    _: UserModel = Depends(require_permission(PERM_ORDER_CREATE)),
    db: Session = Depends(get_db),
):
    """新建一单一条来料（单行 order_items）。"""
    if db.get(Customer, body.customer_id) is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    payload = body.model_dump()
    cust_id = payload.pop("customer_id")
    order_remark = payload.pop("order_remark", None)
    finished_outputs = payload.pop("finished_outputs", None)
    item_fields = OrderItemCreate(**payload).model_dump()
    item_fields.pop("finished_outputs", None)
    if item_fields.get("incoming_date") is None:
        item_fields["incoming_date"] = date.today()

    row = None
    for _ in range(40):
        try:
            order_no = generate_next_order_no(db, customer_id=cust_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
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

    fo = replace_finished_outputs(db, row, finished_outputs)
    if row.production_status not in ("在库中", "已发回"):
        sync_processing_codes_length(row)
        ensure_order_item_processing_codes(db, row)
    db.commit()
    db.refresh(row)

    cust = db.get(Customer, cust_id)
    assert cust is not None
    base = OrderItemOut.model_validate(row).model_dump()
    base["finished_outputs"] = fo
    return TaskItemOut(
        **base,
        customer_name=cust.name,
        order_created_at=row.created_at,
        order_status=_single_row_order_status(row),
        case_study_count=0,
        case_study_by_unit={},
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_item(
    item_id: int,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    """删除该来料订单行（一单一行）。"""
    row = db.get(OrderItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    db.delete(row)
    db.commit()
    return None


@router.get("/cut-head-logs", response_model=CutHeadLogListOut)
def list_cut_head_logs(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="订单号/来料编号/客户名"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    conds: list = []
    if q and q.strip():
        kw = q.strip()
        conds.append(
            or_(
                OrderItem.order_no.contains(kw),
                OrderItem.incoming_no.contains(kw),
                Customer.name.contains(kw),
            )
        )

    count_stmt = (
        select(func.count(CutHeadLog.id))
        .join(OrderItem, CutHeadLog.order_item_id == OrderItem.id)
        .join(Customer, OrderItem.customer_id == Customer.id)
        .where(*conds)
    )
    total = int(db.scalar(count_stmt) or 0)

    stmt = (
        select(
            CutHeadLog,
            OrderItem.order_no,
            OrderItem.incoming_no,
            OrderItem.material_grade,
            Customer.name,
        )
        .join(OrderItem, CutHeadLog.order_item_id == OrderItem.id)
        .join(Customer, OrderItem.customer_id == Customer.id)
        .where(*conds)
        .order_by(CutHeadLog.id.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    out: list[CutHeadLogRow] = []
    for log, order_no, incoming_no, material_grade, cust_name in rows:
        out.append(
            CutHeadLogRow(
                id=log.id,
                order_item_id=log.order_item_id,
                order_no=str(order_no),
                customer_name=str(cust_name),
                incoming_no=incoming_no,
                material_grade=material_grade,
                weight=log.weight,
                created_at=log.created_at,
            )
        )
    return CutHeadLogListOut(items=out, total=total)


@router.post("/cut-head-logs", response_model=CutHeadLogRow, status_code=status.HTTP_201_CREATED)
def create_cut_head_log(
    body: CutHeadLogCreate,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    item = db.get(OrderItem, body.order_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="订单明细不存在")
    if item.production_status in ("在库中", "已发回", "待发回", "出库中"):
        raise HTTPException(status_code=400, detail="只能选择处理中订单")
    if body.weight <= 0:
        raise HTTPException(status_code=400, detail="切头重量必须大于 0")
    log = CutHeadLog(order_item_id=item.id, weight=body.weight)
    db.add(log)
    cur = item.cut_head_weight or 0
    item.cut_head_weight = cur + body.weight
    db.commit()
    db.refresh(log)
    cust = db.get(Customer, item.customer_id)
    assert cust is not None
    return CutHeadLogRow(
        id=log.id,
        order_item_id=item.id,
        order_no=item.order_no,
        customer_name=cust.name,
        incoming_no=item.incoming_no,
        material_grade=item.material_grade,
        weight=log.weight,
        created_at=log.created_at,
    )


@router.post("/split-order", response_model=SplitOrderOut, status_code=status.HTTP_201_CREATED)
def split_order(
    body: SplitOrderBody,
    current: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    item = db.get(OrderItem, body.order_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="订单明细不存在")
    if item.split_group_id is not None:
        raise HTTPException(status_code=400, detail="拆分订单未合并前，不能再次拆分")
    if item.order_no.endswith("-1") or item.order_no.endswith("-2"):
        raise HTTPException(status_code=400, detail="该订单已为拆分后编号，不能再拆分")
    if not item.in_today_queue:
        raise HTTPException(status_code=400, detail="只能拆分今日处理订单")
    if not _is_processing_status(item.production_status):
        raise HTTPException(status_code=400, detail="只能在处理中阶段拆分")
    qty = int(item.quantity or 0)
    if qty <= 1:
        raise HTTPException(status_code=400, detail="该订单无可拆分件数")
    uniq = sorted(set(int(x) for x in body.move_unit_indexes))
    if len(uniq) >= qty:
        raise HTTPException(status_code=400, detail="拆分件数不能等于或超过总件数")
    if any(i < 0 or i >= qty for i in uniq):
        raise HTTPException(status_code=400, detail="拆分件序号超出范围")

    base = item.order_no
    order_no_1 = f"{base}-1"
    order_no_2 = f"{base}-2"
    exists = db.scalars(select(OrderItem.order_no).where(OrderItem.order_no.in_([order_no_1, order_no_2]))).all()
    if exists:
        raise HTTPException(status_code=400, detail="拆分订单号已存在，请检查数据")

    if item.processing_unit_codes is None:
        sync_processing_codes_length(item)
        ensure_order_item_processing_codes(db, item)
        db.flush()
        db.refresh(item)

    codes = list(item.processing_unit_codes or [])
    if len(codes) != qty:
        sync_processing_codes_length(item)
        ensure_order_item_processing_codes(db, item)
        db.flush()
        db.refresh(item)
        codes = list(item.processing_unit_codes or [])
    if len(codes) != qty:
        raise HTTPException(status_code=400, detail="无法生成件号，暂不能拆分")

    moved_codes = [codes[i] for i in uniq]
    kept_codes = [c for idx, c in enumerate(codes) if idx not in set(uniq)]
    moved_qty = len(moved_codes)
    kept_qty = len(kept_codes)

    group_id = uuid4().hex

    w = item.cut_head_weight
    moved_w = None
    kept_w = None
    if w is not None:
        ww = Decimal(str(w))
        moved_w = _quant_3(ww * Decimal(moved_qty) / Decimal(qty))
        kept_w = _quant_3(ww - moved_w)

    new_row = OrderItem(
        order_no=order_no_2,
        customer_id=item.customer_id,
        created_at=item.created_at,
        order_remark=item.order_remark,
        sort_order=item.sort_order,
        incoming_no=item.incoming_no,
        material_grade=item.material_grade,
        spec_incoming=item.spec_incoming,
        weight_incoming=item.weight_incoming,
        quantity=moved_qty,
        weight_return=item.weight_return,
        cut_head_weight=moved_w,
        formed_size=item.formed_size,
        forging_requirements=item.forging_requirements,
        remark=item.remark,
        remark_images=item.remark_images,
        production_status=item.production_status,
        in_today_queue=False,
        in_tomorrow_queue=False,
        processing_unit_codes=moved_codes,
        return_date=item.return_date,
        incoming_date=item.incoming_date,
        cutting_time=item.cutting_time,
        split_group_id=group_id,
        split_base_order_no=base,
        split_seq=2,
    )
    db.add(new_row)

    item.order_no = order_no_1
    item.quantity = kept_qty
    item.processing_unit_codes = kept_codes
    item.cut_head_weight = kept_w
    item.split_group_id = group_id
    item.split_base_order_no = base
    item.split_seq = 1

    db.commit()
    db.refresh(item)
    db.refresh(new_row)

    db.add(
        SplitMergeLog(
            action="split",
            group_id=group_id,
            base_order_no=base,
            order_no_a=order_no_1,
            order_no_b=order_no_2,
            production_status=item.production_status,
            operator_user_id=getattr(current, "id", None),
        )
    )
    db.commit()

    return SplitOrderOut(
        base_order_no=base,
        order_no_1=order_no_1,
        order_no_2=order_no_2,
        item_id_1=item.id,
        item_id_2=new_row.id,
    )


@router.get("/split-merge-logs", response_model=SplitMergeLogListOut)
def list_split_merge_logs(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="订单号"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    conds: list = []
    if q and q.strip():
        kw = q.strip()
        conds.append(
            or_(
                SplitMergeLog.base_order_no.contains(kw),
                SplitMergeLog.order_no_a.contains(kw),
                SplitMergeLog.order_no_b.contains(kw),
            )
        )
    count_stmt = select(func.count(SplitMergeLog.id)).where(*conds)
    total = int(db.scalar(count_stmt) or 0)

    stmt = (
        select(SplitMergeLog, User.username)
        .outerjoin(User, SplitMergeLog.operator_user_id == User.id)
        .where(*conds)
        .order_by(SplitMergeLog.id.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    out: list[SplitMergeLogRow] = []
    for log, uname in rows:
        out.append(
            SplitMergeLogRow(
                id=log.id,
                action=log.action,
                base_order_no=log.base_order_no,
                order_no_a=log.order_no_a,
                order_no_b=log.order_no_b,
                production_status=log.production_status,
                operator_username=uname,
                created_at=log.created_at,
            )
        )
    return SplitMergeLogListOut(items=out, total=total)
