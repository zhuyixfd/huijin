"""订单成品明细：一个来料可对应多个成品（规格/重量各异；件号排产后生成）。"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import OrderItem, OrderItemFinishedOutput
from app.schemas_business import FinishedOutputIn, FinishedOutputOut

def _sum_weights(outputs: list[FinishedOutputIn]) -> Decimal | None:
    total = Decimal("0")
    any_w = False
    for o in outputs:
        if o.weight_return is not None:
            total += Decimal(str(o.weight_return))
            any_w = True
    return total if any_w else None


def _normalize_inputs(raw: list[FinishedOutputIn] | None) -> list[FinishedOutputIn]:
    if not raw:
        return []
    out: list[FinishedOutputIn] = []
    for o in raw:
        if not any(
            [
                o.spec and str(o.spec).strip(),
                o.weight_return is not None,
                o.remark and str(o.remark).strip(),
            ]
        ):
            continue
        out.append(o)
    return out


def _piece_code_for_index(item: OrderItem, sort_order: int) -> str | None:
    codes = item.processing_unit_codes if isinstance(item.processing_unit_codes, list) else []
    if sort_order < 0 or sort_order >= len(codes):
        return None
    raw = codes[sort_order]
    if raw is None:
        return None
    s = str(raw).strip()
    return s if s else None


def load_finished_outputs(db: Session, item_id: int) -> list[OrderItemFinishedOutput]:
    return list(
        db.scalars(
            select(OrderItemFinishedOutput)
            .where(OrderItemFinishedOutput.order_item_id == item_id)
            .order_by(OrderItemFinishedOutput.sort_order, OrderItemFinishedOutput.id)
        ).all()
    )


def finished_outputs_to_out(
    item: OrderItem, rows: list[OrderItemFinishedOutput]
) -> list[FinishedOutputOut]:
    out: list[FinishedOutputOut] = []
    for r in rows:
        fo = FinishedOutputOut.model_validate(r)
        fo.piece_code = _piece_code_for_index(item, r.sort_order)
        out.append(fo)
    return out


def legacy_output_from_item(item: OrderItem) -> list[FinishedOutputOut]:
    """无成品明细表数据时，用订单主行合成一条（兼容旧单）。"""
    return [
        FinishedOutputOut(
            id=0,
            sort_order=0,
            piece_code=_piece_code_for_index(item, 0),
            spec=item.spec_incoming,
            weight_return=item.weight_return,
            remark=None,
        )
    ]


def resolve_finished_outputs(db: Session, item: OrderItem) -> list[FinishedOutputOut]:
    rows = load_finished_outputs(db, item.id)
    if rows:
        return finished_outputs_to_out(item, rows)
    return legacy_output_from_item(item)


def load_finished_outputs_map(
    db: Session, item_ids: list[int], items_by_id: dict[int, OrderItem] | None = None
) -> dict[int, list[FinishedOutputOut]]:
    if not item_ids:
        return {}
    rows = db.scalars(
        select(OrderItemFinishedOutput)
        .where(OrderItemFinishedOutput.order_item_id.in_(item_ids))
        .order_by(
            OrderItemFinishedOutput.order_item_id,
            OrderItemFinishedOutput.sort_order,
            OrderItemFinishedOutput.id,
        )
    ).all()
    by_item: dict[int, list[OrderItemFinishedOutput]] = {}
    for r in rows:
        by_item.setdefault(r.order_item_id, []).append(r)
    out: dict[int, list[FinishedOutputOut]] = {}
    for iid in item_ids:
        if iid not in by_item:
            continue
        item = items_by_id.get(iid) if items_by_id else db.get(OrderItem, iid)
        if item is None:
            continue
        out[iid] = finished_outputs_to_out(item, by_item[iid])
    return out


def sync_item_from_outputs(item: OrderItem, outputs: list[FinishedOutputIn]) -> None:
    n = len(outputs)
    if n > 0:
        item.quantity = n
        item.weight_return = _sum_weights(outputs)


def sync_output_piece_codes_store(db: Session, item: OrderItem) -> None:
    """将已生成的 processing_unit_codes 写回成品明细件号列（便于查询/导出）。"""
    rows = load_finished_outputs(db, item.id)
    if not rows:
        return
    for r in rows:
        r.piece_code = _piece_code_for_index(item, r.sort_order)
    db.flush()


def replace_finished_outputs(
    db: Session,
    item: OrderItem,
    raw: list[FinishedOutputIn] | None,
    *,
    allow_empty: bool = False,
) -> list[FinishedOutputOut]:
    outputs = _normalize_inputs(raw)
    if not outputs and not allow_empty:
        outputs = [
            FinishedOutputIn(
                spec=item.spec_incoming,
                weight_return=item.weight_return,
                remark=None,
            )
        ]

    db.execute(
        delete(OrderItemFinishedOutput).where(
            OrderItemFinishedOutput.order_item_id == item.id
        )
    )
    for i, o in enumerate(outputs):
        db.add(
            OrderItemFinishedOutput(
                order_item_id=item.id,
                sort_order=i,
                piece_code=None,
                spec=(str(o.spec).strip() if o.spec else None) or None,
                formed_size=None,
                weight_return=o.weight_return,
                remark=(str(o.remark).strip() if o.remark else None) or None,
            )
        )
    sync_item_from_outputs(item, outputs)
    db.flush()
    sync_output_piece_codes_store(db, item)
    return resolve_finished_outputs(db, item)


def backfill_finished_outputs_from_items(db: Session) -> int:
    """为尚无成品明细的订单各生成一条（迁移用）。"""
    existing = set(
        db.scalars(select(OrderItemFinishedOutput.order_item_id).distinct()).all()
    )
    items = db.scalars(select(OrderItem)).all()
    n = 0
    for item in items:
        if item.id in existing:
            continue
        replace_finished_outputs(
            db,
            item,
            [
                FinishedOutputIn(
                    spec=item.spec_incoming,
                    weight_return=item.weight_return,
                    remark=None,
                )
            ],
            allow_empty=True,
        )
        n += 1
    if n:
        db.commit()
    return n
