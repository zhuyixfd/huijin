from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.permissions import PERM_ORDER_CREATE, PERM_ORDER_PROCESS
from app.models import CaseStudy, Customer, CutHeadLog, OrderItem, SplitMergeLog, User
from app.models import User as UserModel
from app.order_number import generate_next_order_no
from app.processing_codes import (
    count_processing_piece_strip,
    day_code_char,
    ensure_processing_codes_batch,
)
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
    WorkOrderCreateOut,
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
    material_q: str | None,
    q: str | None,
    search_col: str | None,
    search_value: str | None,
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
    if material_q and material_q.strip():
        conds.append(OrderItem.material_grade.contains(material_q.strip()))
    if q:
        kw = q.strip()
        conds.append(
            or_(
                OrderItem.order_no.contains(kw),
                OrderItem.incoming_no.contains(kw),
            )
        )
    if search_value and search_value.strip():
        kw = search_value.strip()
        col = (search_col or "").strip().lower()
        if col in ("customer", "customer_name"):
            conds.append(Customer.name.contains(kw))
        elif col in ("material", "material_grade"):
            conds.append(OrderItem.material_grade.contains(kw))
        elif col in ("incoming_no", "incoming", "furnace_no"):
            conds.append(OrderItem.incoming_no.contains(kw))
        elif col in ("order_no", "order"):
            conds.append(OrderItem.order_no.contains(kw))
        elif col in ("spec_incoming", "spec"):
            conds.append(OrderItem.spec_incoming.contains(kw))
        elif col in ("weight_incoming", "weight"):
            conds.append(cast(OrderItem.weight_incoming, String).contains(kw))
        elif col in ("incoming_date", "date"):
            conds.append(cast(OrderItem.incoming_date, String).contains(kw))
        else:
            raise HTTPException(status_code=400, detail="无效的 search_col")
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
        today_processing_letter=day_code_char(),
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
    material_q: str | None = Query(None, description="材质模糊"),
    search_col: str | None = Query(
        None,
        description="指定列模糊搜索：customer | material_grade | incoming_no | order_no | spec_incoming | weight_incoming | incoming_date",
    ),
    search_value: str | None = Query(None, description="指定列模糊搜索值"),
    piece_letter: str | None = Query(
        None,
        min_length=1,
        max_length=1,
        description="件号首字母筛选（区分大小写：A 与 a 不同；仅对已生成 processing_unit_codes 的明细生效）",
    ),
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
        material_q=material_q,
        q=q,
        search_col=search_col,
        search_value=search_value,
        status_category=status_category,
        created_from=created_from,
        created_to=created_to,
        exclude_completed=exclude_completed,
    )

    def _matches_piece_letter(item: OrderItem, key: str) -> bool:
        raw = item.processing_unit_codes
        if not raw or not isinstance(raw, list):
            return False
        for s in raw:
            if not isinstance(s, str):
                continue
            t = s.strip()
            if not t:
                continue
            if t[0] == key:
                return True
        return False

    rows: list[tuple[OrderItem, str]] = []
    total: int = 0
    piece_key = (piece_letter or "").strip()
    if piece_key:
        all_stmt = (
            select(OrderItem, Customer.name)
            .join(Customer, OrderItem.customer_id == Customer.id)
            .where(*conds)
            .order_by(OrderItem.id.desc())
        )
        all_rows = db.execute(all_stmt).all()
        proc_items_all = [
            item
            for item, _ in all_rows
            if item.production_status not in ("在库中", "已发回")
        ]
        if proc_items_all:
            ensure_processing_codes_batch(db, proc_items_all)
            db.commit()
            for item in proc_items_all:
                db.refresh(item)
        filtered = [(item, cust_name) for item, cust_name in all_rows if _matches_piece_letter(item, piece_key)]
        total = len(filtered)
        rows = filtered[skip : skip + limit]
    else:
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


@router.post("/work-orders", response_model=WorkOrderCreateOut, status_code=status.HTTP_201_CREATED)
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

    from app.order_item_finished import normalize_finished_output_inputs

    outs = normalize_finished_output_inputs(finished_outputs)
    is_multi = len(outs) > 1

    cust = db.get(Customer, cust_id)
    assert cust is not None

    created: list[OrderItem] = []
    for _ in range(40):
        try:
            base_no = generate_next_order_no(db, customer_id=cust_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        try:
            created = []
            if not is_multi:
                row = OrderItem(
                    order_no=base_no,
                    customer_id=cust_id,
                    order_remark=order_remark,
                    sort_order=0,
                    **item_fields,
                )
                db.add(row)
                db.flush()
                replace_finished_outputs(db, row, finished_outputs)
                created.append(row)
            else:
                for i, fo in enumerate(outs, start=1):
                    order_no = f"{base_no}-{i}"
                    row = OrderItem(
                        order_no=order_no,
                        customer_id=cust_id,
                        order_remark=order_remark,
                        sort_order=0,
                        split_base_order_no=base_no,
                        split_seq=i,
                        **item_fields,
                    )
                    db.add(row)
                    db.flush()
                    replace_finished_outputs(db, row, [fo])
                    created.append(row)
            proc_items = [r for r in created if r.production_status not in ("在库中", "已发回")]
            if proc_items:
                ensure_processing_codes_batch(db, proc_items)
            db.commit()
            for r in created:
                db.refresh(r)
            break
        except IntegrityError:
            db.rollback()
            created = []
            continue
    if not created:
        raise HTTPException(status_code=500, detail="无法生成唯一订单编号，请重试")

    items_out: list[TaskItemOut] = []
    for row in created:
        base = OrderItemOut.model_validate(row).model_dump()
        base["finished_outputs"] = resolve_finished_outputs(db, row)
        items_out.append(
            TaskItemOut(
                **base,
                customer_name=cust.name,
                order_created_at=row.created_at,
                order_status=_single_row_order_status(row),
                case_study_count=0,
                case_study_by_unit={},
            )
        )
    return WorkOrderCreateOut(items=items_out)


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
    import re

    if not item.in_today_queue:
        raise HTTPException(status_code=400, detail="只能拆分今日处理订单")
    if not _is_processing_status(item.production_status):
        raise HTTPException(status_code=400, detail="只能在处理中阶段拆分")
    uniq = sorted(set(int(x) for x in body.move_unit_indexes))
    qty_raw = item.quantity
    qty = int(qty_raw) if qty_raw is not None else 0
    quantity_known = qty >= 1
    if quantity_known:
        if qty <= 1:
            raise HTTPException(status_code=400, detail="该订单无可拆分件数")
        if len(uniq) == 0:
            raise HTTPException(status_code=400, detail="请至少选择一件拆分")
        if len(uniq) >= qty:
            raise HTTPException(status_code=400, detail="拆分件数不能等于或超过总件数")
        if any(i < 0 or i >= qty for i in uniq):
            raise HTTPException(status_code=400, detail="拆分件序号超出范围")
    else:
        uniq = []

    raw_order_no = str(item.order_no or "").strip()
    mcur = re.match(r"^(.*?)-(\d+)$", raw_order_no)
    base = mcur.group(1) if mcur else raw_order_no
    has_suffix = mcur is not None

    existing = db.scalars(select(OrderItem.order_no).where(OrderItem.order_no.like(f"{base}-%"))).all()
    max_seq = 0
    for s in existing:
        m = re.match(rf"^{re.escape(base)}-(\d+)$", str(s or "").strip())
        if not m:
            continue
        max_seq = max(max_seq, int(m.group(1)))
    if has_suffix:
        order_no_1 = raw_order_no
        next_seq = (max_seq + 1) if max_seq >= 1 else 1
        order_no_2 = f"{base}-{next_seq}"
    else:
        order_no_1 = f"{base}-1"
        if max_seq >= 2:
            order_no_2 = f"{base}-{max_seq + 1}"
        else:
            order_no_2 = f"{base}-2"
        conflict_1 = db.scalar(select(OrderItem.id).where(OrderItem.order_no == order_no_1))
        if conflict_1 is not None and int(conflict_1) != int(item.id):
            raise HTTPException(status_code=400, detail="拆分订单号冲突，请检查数据")
        item.order_no = order_no_1
    conflict = db.scalar(select(OrderItem.id).where(OrderItem.order_no == order_no_2))
    if conflict is not None:
        raise HTTPException(status_code=400, detail="拆分订单号已存在，请检查数据")

    if quantity_known and item.processing_unit_codes is None:
        sync_processing_codes_length(item)
        ensure_order_item_processing_codes(db, item)
        db.flush()
        db.refresh(item)

    codes = list(item.processing_unit_codes or [])
    if quantity_known and len(codes) != qty:
        sync_processing_codes_length(item)
        ensure_order_item_processing_codes(db, item)
        db.flush()
        db.refresh(item)
        codes = list(item.processing_unit_codes or [])
    if quantity_known and len(codes) != qty:
        raise HTTPException(status_code=400, detail="无法生成件号，暂不能拆分")

    moved_codes = [codes[i] for i in uniq]
    kept_codes = [c for idx, c in enumerate(codes) if idx not in set(uniq)]
    moved_qty = len(moved_codes) if quantity_known else None
    kept_qty = len(kept_codes) if quantity_known else None

    w = item.cut_head_weight
    moved_w = None
    kept_w = None
    if w is not None and quantity_known:
        ww = Decimal(str(w))
        moved_w = _quant_3(ww * Decimal(moved_qty) / Decimal(qty))
        kept_w = _quant_3(ww - moved_w)
    elif w is not None:
        kept_w = w

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
        incoming_quantity=item.incoming_quantity,
        quantity=moved_qty,
        weight_return=item.weight_return,
        cut_head_weight=moved_w,
        formed_size=item.formed_size,
        forging_requirements=item.forging_requirements,
        remark=item.remark,
        remark_images=item.remark_images,
        incoming_sheet_images=item.incoming_sheet_images,
        production_status=item.production_status,
        in_today_queue=True,
        in_tomorrow_queue=False,
        processing_unit_codes=moved_codes if quantity_known else None,
        return_date=item.return_date,
        promised_return_date=item.promised_return_date,
        returned_at=item.returned_at,
        incoming_date=item.incoming_date,
        cutting_time=item.cutting_time,
    )
    db.add(new_row)

    item.quantity = kept_qty
    item.processing_unit_codes = kept_codes if quantity_known else item.processing_unit_codes
    item.cut_head_weight = kept_w

    db.commit()
    db.refresh(item)
    db.refresh(new_row)

    db.add(
        SplitMergeLog(
            action="split",
            group_id=uuid4().hex,
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


@router.get("/split-order-next")
def split_order_next(
    order_item_id: int | None = Query(None, description="今日处理订单明细 ID"),
    base: str | None = Query(None, description="原始订单号（兼容旧参数）"),
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    import re

    if order_item_id is not None:
        it = db.get(OrderItem, int(order_item_id))
        if it is None:
            raise HTTPException(status_code=404, detail="订单明细不存在")
        raw_order_no = str(it.order_no or "").strip()
    else:
        if not base or not base.strip():
            raise HTTPException(status_code=400, detail="缺少 base 或 order_item_id")
        raw_order_no = base.strip()

    mcur = re.match(r"^(.*?)-(\d+)$", raw_order_no)
    b = mcur.group(1) if mcur else raw_order_no
    has_suffix = mcur is not None
    existing = db.scalars(select(OrderItem.order_no).where(OrderItem.order_no.like(f"{b}-%"))).all()
    max_seq = 0
    for s in existing:
        m = re.match(rf"^{re.escape(b)}-(\d+)$", str(s or "").strip())
        if not m:
            continue
        max_seq = max(max_seq, int(m.group(1)))
    if has_suffix:
        next_seq = (max_seq + 1) if max_seq >= 1 else 1
        return {"order_no_1": raw_order_no, "order_no_2": f"{b}-{next_seq}"}
    if max_seq >= 2:
        return {"order_no_1": f"{b}-1", "order_no_2": f"{b}-{max_seq + 1}"}
    return {"order_no_1": f"{b}-1", "order_no_2": f"{b}-2"}


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
