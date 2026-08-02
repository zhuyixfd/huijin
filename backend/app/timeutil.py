"""统一业务时区：Asia/Shanghai（北京时间）。"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

CN_TZ = ZoneInfo("Asia/Shanghai")


def now_cn() -> datetime:
    """当前北京时间（naive，与 MySQL DATETIME +08:00 一致）。"""
    return datetime.now(CN_TZ).replace(tzinfo=None)


def today_cn() -> date:
    return now_cn().date()
