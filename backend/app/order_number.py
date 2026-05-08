"""订单编号：hj + 客户缩写 + 年月日 + 当日流水（5 位），由服务端生成。"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Customer, OrderItem


def generate_next_order_no(db: Session, *, customer_id: int) -> str:
    cust = db.get(Customer, customer_id)
    if cust is None:
        raise ValueError("客户不存在")
    raw = (cust.abbr or "").strip()
    abbr = "".join(c for c in raw if c.isalnum()).upper()
    if not abbr:
        raise ValueError("客户缩写无效")

    day = datetime.now().strftime("%Y%m%d")
    prefix = f"hj{abbr}{day}"
    nos = db.scalars(
        select(OrderItem.order_no).where(OrderItem.order_no.startswith(prefix))
    ).all()
    max_n = 0
    for num in nos:
        suf = num[len(prefix) :]
        try:
            max_n = max(max_n, int(suf))
        except ValueError:
            continue
    return f"{prefix}{max_n + 1:05d}"
