"""订单编号：HJ + 年月日 + 当日流水（5 位），由服务端生成。"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order


def generate_next_order_no(db: Session) -> str:
    day = datetime.now().strftime("%Y%m%d")
    prefix = f"HJ{day}"
    nos = db.scalars(
        select(Order.order_no).where(Order.order_no.startswith(prefix))
    ).all()
    max_n = 0
    for raw in nos:
        suf = raw[len(prefix) :]
        try:
            max_n = max(max_n, int(suf))
        except ValueError:
            continue
    return f"{prefix}{max_n + 1:05d}"
