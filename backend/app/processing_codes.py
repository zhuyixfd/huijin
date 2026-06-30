"""处理中单件编号：按自然月日序分配首字母（1 日 A、2 日 B…）+ 全库惟一数字后缀；同一订单内用“-序号”区分支号。"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants_metal import slowest_production_status
from app.models import OrderItem

# 共 31 个：每月 1 日 A … 26 日 Z、27 日 a … 31 日 e；每月 1 日重新从 A 起（区分大小写）
DAY_CODE_CYCLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcde"


def count_processing_piece_strip(db: Session) -> list[tuple[str, int]]:
    """当前「处理中」且不含待出库的明细：按件号首字母累计件数（仅已有 processing_unit_codes 的件）。"""
    rows = db.scalars(
        select(OrderItem.processing_unit_codes).where(
            OrderItem.production_status != "在库中",
            OrderItem.production_status != "已发回",
            OrderItem.production_status != "待发回",
            OrderItem.production_status != "出库中",
            OrderItem.processing_unit_codes.isnot(None),
        )
    ).all()
    tallies: dict[str, int] = {c: 0 for c in DAY_CODE_CYCLE}
    for raw in rows:
        if not raw or not isinstance(raw, list):
            continue
        for s in raw:
            if not isinstance(s, str):
                continue
            t = s.strip()
            if not t:
                continue
            ch = t[0]
            if ch in tallies:
                tallies[ch] += 1
    return [(letter, tallies[letter]) for letter in DAY_CODE_CYCLE]


def day_code_char(ref: date | None = None) -> str:
    """当日件号首字母：按当月第几天取轮回表（非跨月连续）。"""
    d = ref or date.today()
    dom = max(1, min(int(d.day), len(DAY_CODE_CYCLE)))
    return DAY_CODE_CYCLE[dom - 1]


def day_code_char_by_dom(day_of_month: int) -> str:
    dom = max(1, min(int(day_of_month), len(DAY_CODE_CYCLE)))
    return DAY_CODE_CYCLE[dom - 1]


def _suffix_int(label: str) -> int | None:
    m = re.match(r"^[A-Za-z](\d+)(?:-\d+)?$", label.strip())
    return int(m.group(1)) if m else None


def _max_numeric_suffix_db(db: Session) -> int:
    """扫描已持久化的件号，取数字后缀最大值（用于新号递增）。"""
    rows = db.scalars(select(OrderItem.processing_unit_codes)).all()
    m = 0
    for raw in rows:
        if not raw or not isinstance(raw, list):
            continue
        for s in raw:
            if not isinstance(s, str):
                continue
            t = s.strip()
            if not t:
                continue
            v = _suffix_int(t)
            if v is not None:
                m = max(m, v)
    return m


def _normalize_codes_list(raw: object | None, qty: int) -> list[str | None]:
    out: list[str | None]
    if isinstance(raw, list):
        out = []
        for x in raw:
            if x is None:
                out.append(None)
            else:
                s = str(x).strip()
                out.append(s if s else None)
    else:
        out = [None] * qty
    while len(out) < qty:
        out.append(None)
    return out[:qty]


def ensure_order_item_processing_codes(db: Session, row: OrderItem) -> None:
    """保证 processing_unit_codes 长度与 quantity 一致，空位按同一前缀用“-序号”补齐。"""
    if row.production_status == "已发回":
        return
    if row.production_status == "在库中":
        qty0 = max(1, int(row.quantity or 1))
        fallback = row.production_status or "在库中"
        raw = row.unit_production_statuses
        if isinstance(raw, list):
            base: list[str] = []
            for x in raw:
                s = str(x).strip() if x is not None else ""
                base.append(s if s else fallback)
        else:
            base = [fallback] * qty0
        while len(base) < qty0:
            base.append(fallback)
        base = base[:qty0]
        any_processing = any(st not in ("在库中", "已发回") for st in base)
        if not any_processing:
            return

    qty = max(1, int(row.quantity or 1))
    codes = _normalize_codes_list(row.processing_unit_codes, qty)
    seed = next((c for c in codes if isinstance(c, str) and str(c).strip()), None)
    if seed:
        s = str(seed).strip()
        m = re.match(r"^(.+?)-\d+$", s)
        prefix = m.group(1) if m else s
    else:
        day_char = day_code_char()
        next_n = _max_numeric_suffix_db(db) + 1
        prefix = f"{day_char}{next_n}"
    changed = False
    for i in range(qty):
        if codes[i]:
            continue
        codes[i] = prefix if qty == 1 else f"{prefix}-{i + 1}"
        changed = True
    if changed:
        row.processing_unit_codes = [c for c in codes]
    _sync_finished_piece_codes(db, row)


def _sync_finished_piece_codes(db: Session, row: OrderItem) -> None:
    from app.order_item_finished import sync_output_piece_codes_store

    sync_output_piece_codes_store(db, row)


def ensure_processing_codes_batch(db: Session, items: list[OrderItem]) -> None:
    """同一事务内批量分配，后缀连续递增。"""
    rows: list[OrderItem] = []
    for r in items:
        if r.production_status == "已发回":
            continue
        if r.production_status != "在库中":
            rows.append(r)
            continue
        qty0 = max(1, int(r.quantity or 1))
        fallback = r.production_status or "在库中"
        raw = r.unit_production_statuses
        if isinstance(raw, list):
            base: list[str] = []
            for x in raw:
                s = str(x).strip() if x is not None else ""
                base.append(s if s else fallback)
        else:
            base = [fallback] * qty0
        while len(base) < qty0:
            base.append(fallback)
        base = base[:qty0]
        any_processing = any(st not in ("在库中", "已发回") for st in base)
        if any_processing:
            rows.append(r)
    if not rows:
        return
    next_n = _max_numeric_suffix_db(db) + 1
    day_char = day_code_char()
    for row in rows:
        qty = max(1, int(row.quantity or 1))
        codes = _normalize_codes_list(row.processing_unit_codes, qty)
        seed = next((c for c in codes if isinstance(c, str) and str(c).strip()), None)
        if seed:
            s = str(seed).strip()
            m = re.match(r"^(.+?)-\d+$", s)
            prefix = m.group(1) if m else s
        else:
            prefix = f"{day_char}{next_n}"
            next_n += 1
        changed = False
        for i in range(qty):
            if codes[i]:
                continue
            codes[i] = prefix if qty == 1 else f"{prefix}-{i + 1}"
            changed = True
        if changed:
            row.processing_unit_codes = [c for c in codes]
        _sync_finished_piece_codes(db, row)


def reassign_processing_codes_batch(
    db: Session,
    items: list[OrderItem],
    *,
    day_of_month: int,
) -> None:
    """批量重排件号：按指定日序字母 + 全库递增数字后缀，覆盖原有 processing_unit_codes。"""
    rows = [r for r in items if r is not None and r.production_status not in ("在库中", "已发回", "待发回", "出库中")]
    if not rows:
        return
    next_n = _max_numeric_suffix_db(db) + 1
    day_char = day_code_char_by_dom(day_of_month)
    for row in rows:
        qty = max(1, int(row.quantity or 1))
        prefix = f"{day_char}{next_n}"
        next_n += 1
        row.processing_unit_codes = (
            [prefix] if qty == 1 else [f"{prefix}-{i + 1}" for i in range(qty)]
        )
        _sync_finished_piece_codes(db, row)


def sync_processing_codes_length(row: OrderItem) -> None:
    """数量变更时裁切或右侧补空（由 ensure 再补齐）；尚无编号时不写入。"""
    qty = max(1, int(row.quantity or 1))
    raw = row.processing_unit_codes
    if raw is None or not isinstance(raw, list):
        return
    codes = _normalize_codes_list(raw, qty)
    row.processing_unit_codes = codes


def _normalize_unit_statuses_list(raw: object | None, qty: int, fallback: str) -> list[str]:
    out: list[str]
    if isinstance(raw, list):
        out = []
        for x in raw:
            s = str(x).strip() if x is not None else ""
            out.append(s if s else fallback)
    else:
        out = [fallback] * qty
    while len(out) < qty:
        out.append(fallback)
    return out[:qty]


def sync_unit_production_statuses_length(row: OrderItem) -> None:
    qty = max(1, int(row.quantity or 1))
    raw = row.unit_production_statuses
    if raw is None or not isinstance(raw, list):
        return
    fallback = row.production_status or "在库中"
    row.unit_production_statuses = _normalize_unit_statuses_list(raw, qty, fallback)


def set_all_unit_production_statuses(row: OrderItem, status: str) -> None:
    qty = max(1, int(row.quantity or 1))
    row.unit_production_statuses = [status] * qty
    row.production_status = slowest_production_status(row.unit_production_statuses, fallback=status)
