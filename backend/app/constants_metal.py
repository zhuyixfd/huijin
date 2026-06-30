"""金属加工订单 — 生产状态（含修磨可多次，状态停留「修磨中」直至下一工序）"""

PRODUCTION_STATUSES: tuple[str, ...] = (
    "在库中",
    "开坯",
    "待修磨",
    "修磨中",
    "锻造中",
    "二次锻造",
    "二次修磨",
    "三锻造",
    "三次修磨",
    "待发回",
    "出库中",
    "已发回",
    "出白",
    "固溶",
    "切割",
)

PRODUCTION_STATUS_RANK: dict[str, int] = {s: i for i, s in enumerate(PRODUCTION_STATUSES)}


def slowest_production_status(statuses: list[str] | None, *, fallback: str = "在库中") -> str:
    if not statuses:
        return fallback
    best = None
    for s in statuses:
        if not s:
            continue
        r = PRODUCTION_STATUS_RANK.get(s)
        if r is None:
            continue
        if best is None or r < best:
            best = r
    if best is None:
        return fallback
    return PRODUCTION_STATUSES[best]
