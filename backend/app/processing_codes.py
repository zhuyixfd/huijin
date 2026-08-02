"""处理中单件编号：按自然月日序分配首字母（1 日 A、2 日 B…）+ 全库惟一数字后缀；同一订单内用“-序号”区分支号。"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants_metal import slowest_production_status
from app.models import OrderItem
from app.timeutil import today_cn

# 共 31 个：每月 1 日 A … 26 日 Z、27 日 a … 31 日 e；每月 1 日重新从 A 起（区分大小写）
DAY_CODE_CYCLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcde"

# 全库件号数字后缀最大值缓存（避免列表接口反复全表扫描 JSON）
_max_suffix_cache: int | None = None


def invalidate_max_suffix_cache() -> None:
    global _max_suffix_cache
    _max_suffix_cache = None


def _bump_max_suffix_cache(n: int) -> None:
    global _max_suffix_cache
    if _max_suffix_cache is None or n > _max_suffix_cache:
        _max_suffix_cache = n


def codes_are_complete(row: OrderItem) -> bool:
    """件号已齐全（长度=支数且无空位）时可跳过列表补齐。"""
    if row.quantity is None:
        return True
    qty = max(1, int(row.quantity or 1))
    raw = row.processing_unit_codes
    if not isinstance(raw, list) or len(raw) < qty:
        return False
    for i in range(qty):
        c = raw[i]
        if c is None or not str(c).strip():
            return False
    return True


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
    d = ref or today_cn()
    dom = max(1, min(int(d.day), len(DAY_CODE_CYCLE)))
    return DAY_CODE_CYCLE[dom - 1]


def day_code_char_by_dom(day_of_month: int) -> str:
    dom = max(1, min(int(day_of_month), len(DAY_CODE_CYCLE)))
    return DAY_CODE_CYCLE[dom - 1]


def _anchor_date_for_piece_code(row: OrderItem) -> date:
    """历史锚定日（下料/来料/创建）；新分配件号首字母已改用排产当日，见 _assign_continuous_codes_for_group。"""
    ct = row.cutting_time
    if ct is not None:
        try:
            return ct.date() if hasattr(ct, "date") else today_cn()
        except (TypeError, ValueError):
            pass
    inc = row.incoming_date
    if inc is not None:
        return inc
    ca = row.created_at
    if ca is not None:
        try:
            return ca.date() if hasattr(ca, "date") else today_cn()
        except (TypeError, ValueError):
            pass
    return today_cn()


def _day_char_for_item(row: OrderItem) -> str:
    return day_code_char(_anchor_date_for_piece_code(row))


def _suffix_int(label: str) -> int | None:
    m = re.match(r"^[A-Za-z](\d+)(?:-\d+)?$", label.strip())
    return int(m.group(1)) if m else None


def _max_numeric_suffix_db(db: Session) -> int:
    """扫描已持久化的件号，取数字后缀最大值（用于新号递增）。"""
    global _max_suffix_cache
    if _max_suffix_cache is not None:
        return _max_suffix_cache
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
    _max_suffix_cache = m
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

    if codes_are_complete(row):
        return
    qty = max(1, int(row.quantity or 1))
    codes = _normalize_codes_list(row.processing_unit_codes, qty)
    seed = next((c for c in codes if isinstance(c, str) and str(c).strip()), None)
    if seed:
        prefix = _extract_code_prefix(str(seed).strip())
    else:
        prefix = None
    _assign_continuous_codes_for_group(db, [row], next_n=_max_numeric_suffix_db(db) + 1, force_prefix=prefix)


def _sync_finished_piece_codes(db: Session, row: OrderItem) -> None:
    from app.order_item_finished import sync_output_piece_codes_store

    sync_output_piece_codes_store(db, row)


def _extract_code_prefix(label: str) -> str:
    s = label.strip()
    m = re.match(r"^(.+?)-\d+$", s)
    return m.group(1) if m else s


def _family_group_key(row: OrderItem) -> str | None:
    """同一来料拆出的多规格子单（旧数据）共用连续件号。"""
    base = str(row.split_base_order_no or "").strip()
    if base and row.split_group_id is None:
        return base
    return None


def _max_suffix_in_codes(codes: list[str | None]) -> int:
    m = 0
    for c in codes:
        if not c:
            continue
        hit = re.match(r"^.+-(\d+)$", str(c).strip())
        if hit:
            m = max(m, int(hit.group(1)))
    return m


def _assign_continuous_codes_for_group(
    db: Session,
    items: list[OrderItem],
    *,
    next_n: int,
    force_prefix: str | None = None,
    force_day_char: str | None = None,
) -> int:
    """一组订单（通常同一来料）共用前缀，件号为 prefix-1、prefix-2… 连续编号。"""
    if not items:
        return next_n
    items = sorted(items, key=lambda r: (int(r.split_seq or 0), int(r.id or 0)))

    prefix = force_prefix
    if not prefix:
        for row in items:
            for c in row.processing_unit_codes or []:
                if isinstance(c, str) and str(c).strip():
                    prefix = _extract_code_prefix(str(c).strip())
                    break
            if prefix:
                break
    if not prefix:
        day_char = force_day_char or day_code_char(today_cn())
        prefix = f"{day_char}{next_n}"
        next_n += 1

    seq = 0
    for row in items:
        qty = max(1, int(row.quantity or 1))
        codes = _normalize_codes_list(row.processing_unit_codes, qty)
        seq = max(seq, _max_suffix_in_codes([c for c in codes if c]))

    total_slots = sum(max(1, int(r.quantity or 1)) for r in items)
    use_suffix = total_slots > 1

    for row in items:
        qty = max(1, int(row.quantity or 1))
        codes = _normalize_codes_list(row.processing_unit_codes, qty)
        changed = False
        for i in range(qty):
            if codes[i]:
                continue
            seq += 1
            codes[i] = f"{prefix}-{seq}" if use_suffix else prefix
            changed = True
        if changed:
            row.processing_unit_codes = [c for c in codes]
            _sync_finished_piece_codes(db, row)
            for c in codes:
                if c:
                    v = _suffix_int(str(c))
                    if v is not None:
                        _bump_max_suffix_cache(v)
    return next_n


def ensure_processing_codes_batch(db: Session, items: list[OrderItem]) -> None:
    """同一事务内批量分配；同一来料（多规格）共用一件号前缀，支号连续。"""
    rows: list[OrderItem] = []
    for r in items:
        if r.production_status == "已发回":
            continue
        if r.production_status != "在库中":
            if not codes_are_complete(r):
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
        if any_processing and not codes_are_complete(r):
            rows.append(r)
    if not rows:
        return

    by_family: dict[str, list[OrderItem]] = {}
    standalone: list[OrderItem] = []
    for row in rows:
        fk = _family_group_key(row)
        if fk:
            by_family.setdefault(fk, []).append(row)
        else:
            standalone.append(row)

    groups: list[list[OrderItem]] = list(by_family.values()) + [[r] for r in standalone]
    next_n = _max_numeric_suffix_db(db) + 1
    for group in groups:
        next_n = _assign_continuous_codes_for_group(db, group, next_n=next_n)


def ensure_processing_codes_for_items(db: Session, items: list[OrderItem]) -> int:
    """仅补齐空位，不覆盖已有件号。"""
    before = _max_numeric_suffix_db(db)
    ensure_processing_codes_batch(db, items)
    after = _max_numeric_suffix_db(db)
    return max(0, after - before)


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
    by_family: dict[str, list[OrderItem]] = {}
    standalone: list[OrderItem] = []
    for row in rows:
        fk = _family_group_key(row)
        if fk:
            by_family.setdefault(fk, []).append(row)
        else:
            standalone.append(row)
    groups: list[list[OrderItem]] = list(by_family.values()) + [[r] for r in standalone]
    invalidate_max_suffix_cache()
    next_n = _max_numeric_suffix_db(db) + 1
    day_char = day_code_char_by_dom(day_of_month)
    for group in groups:
        for row in group:
            row.processing_unit_codes = None
        next_n = _assign_continuous_codes_for_group(
            db, group, next_n=next_n, force_day_char=day_char
        )
    invalidate_max_suffix_cache()


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
