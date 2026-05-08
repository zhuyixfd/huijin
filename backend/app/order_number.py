"""订单编号：hj + 企业缩写 + 年月日 + 当日流水（5 位），由服务端生成。"""

import os
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import OrderItem


def _enterprise_abbr() -> str:
    raw = os.environ.get("ORDER_ENTERPRISE_ABBR", "HJT").strip()
    if not raw:
        return "HJT"
    return "".join(c for c in raw if c.isalnum()) or "HJT"


def generate_next_order_no(db: Session) -> str:
    abbr = _enterprise_abbr()
    day = datetime.now().strftime("%Y%m%d")
    prefix = f"hj{abbr}{day}"
    nos = db.scalars(
        select(OrderItem.order_no).where(OrderItem.order_no.startswith(prefix))
    ).all()
    max_n = 0
    for raw in nos:
        suf = raw[len(prefix) :]
        try:
            max_n = max(max_n, int(suf))
        except ValueError:
            continue
    return f"{prefix}{max_n + 1:05d}"
