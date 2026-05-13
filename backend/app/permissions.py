"""员工细粒度业务权限（管理员不受限）。"""

from __future__ import annotations

from typing import Any

PERM_ORDER_CREATE = "order_create"
PERM_ORDER_PROCESS = "order_process"
PERM_ORDER_OUTBOUND = "order_outbound"
PERM_ORDER_CONFIRM_SHIP = "order_confirm_ship"

PERMISSION_LABELS: dict[str, str] = {
    PERM_ORDER_CREATE: "新建订单",
    PERM_ORDER_PROCESS: "处理订单",
    PERM_ORDER_OUTBOUND: "出库订单",
    PERM_ORDER_CONFIRM_SHIP: "确认出库",
}

ALL_PERMISSION_CODES: tuple[str, ...] = tuple(PERMISSION_LABELS.keys())


def effective_permission_codes(user: Any) -> set[str]:
    if getattr(user, "role", None) == "admin":
        return set(ALL_PERMISSION_CODES)
    raw = getattr(user, "permission_codes", None)
    # NULL / 未配置：兼容旧员工，视为全部业务权限
    if raw is None:
        return set(ALL_PERMISSION_CODES)
    if not isinstance(raw, list):
        return set(ALL_PERMISSION_CODES)
    # 显式保存的空列表：无任何业务权限
    if len(raw) == 0:
        return set()
    return {str(x) for x in raw if x in PERMISSION_LABELS}


def has_permission(user: Any, code: str) -> bool:
    return code in effective_permission_codes(user)


def required_perm_for_item_patch(old: Any, data: dict) -> str:
    """单条明细 PATCH 所需业务权限码。"""
    if "production_status" not in data and "in_today_queue" not in data:
        return PERM_ORDER_PROCESS
    new_ps = data.get("production_status", old.production_status)
    if new_ps == "已发回":
        return PERM_ORDER_CONFIRM_SHIP
    old_ps = old.production_status
    if old_ps in ("待发回", "出库中"):
        return PERM_ORDER_OUTBOUND
    return PERM_ORDER_PROCESS


def required_perm_for_batch(items: list[Any], target_status: str) -> str:
    if target_status == "已发回":
        return PERM_ORDER_CONFIRM_SHIP
    if target_status in ("待发回", "出库中"):
        return PERM_ORDER_OUTBOUND
    for row in items:
        if row.production_status in ("待发回", "出库中"):
            return PERM_ORDER_OUTBOUND
    return PERM_ORDER_PROCESS
