"""处理中单件编号：32 日字母轮回 + 全库惟一数字后缀；已写入的编号永久保留。"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import OrderItem

# 共 32 个：A～Z 依次 + abcdef（与车间件号字母排序一致）
DAY_CODE_CYCLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"


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
    d = ref or date.today()
    return DAY_CODE_CYCLE[d.toordinal() % len(DAY_CODE_CYCLE)]


def _suffix_int(label: str) -> int | None:
    m = re.search(r"(\d+)$", label.strip())
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
    """保证 processing_unit_codes 长度与 quantity 一致，空位按当日字母 + 递增后缀补齐。"""
    if row.production_status in ("在库中", "已发回"):
        return

    qty = max(1, int(row.quantity or 1))
    codes = _normalize_codes_list(row.processing_unit_codes, qty)
    day_char = day_code_char()
    next_n = _max_numeric_suffix_db(db) + 1
    changed = False
    for i in range(qty):
        if codes[i]:
            continue
        codes[i] = f"{day_char}{next_n}"
        next_n += 1
        changed = True
    if changed:
        row.processing_unit_codes = [c for c in codes]
    _sync_finished_piece_codes(db, row)


def _sync_finished_piece_codes(db: Session, row: OrderItem) -> None:
    from app.order_item_finished import sync_output_piece_codes_store

    sync_output_piece_codes_store(db, row)


def ensure_processing_codes_batch(db: Session, items: list[OrderItem]) -> None:
    """同一事务内批量分配，后缀连续递增。"""
    rows = [r for r in items if r.production_status not in ("在库中", "已发回")]
    if not rows:
        return
    next_n = _max_numeric_suffix_db(db) + 1
    day_char = day_code_char()
    for row in rows:
        qty = max(1, int(row.quantity or 1))
        codes = _normalize_codes_list(row.processing_unit_codes, qty)
        changed = False
        for i in range(qty):
            if codes[i]:
                continue
            codes[i] = f"{day_char}{next_n}"
            next_n += 1
            changed = True
        if changed:
            row.processing_unit_codes = [c for c in codes]
        _sync_finished_piece_codes(db, row)


def sync_processing_codes_length(row: OrderItem) -> None:
    """数量变更时裁切或右侧补空（由 ensure 再补齐）；尚无编号时不写入。"""
    qty = max(1, int(row.quantity or 1))
    raw = row.processing_unit_codes
    if raw is None or not isinstance(raw, list):
        return
    codes = _normalize_codes_list(raw, qty)
    row.processing_unit_codes = codes
