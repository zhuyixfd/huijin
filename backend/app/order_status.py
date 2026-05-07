"""订单层展示状态（由多条来料明细聚合）。"""

ITEM_DONE = "已发回"
ITEM_WAIT_WAREHOUSE = "未入库"


def format_order_status_display(item_count: int, done_count: int, waiting_stock_count: int) -> str:
    """
    - 无明细：已下单
    - 任一来料未入库：待入库
    - 全部来料已发回：已完成
    - 其余：待完成 n/m（m 为来料条数，n 为已发回条数）
    """
    if item_count <= 0:
        return "已下单"
    if waiting_stock_count > 0:
        return "待入库"
    if done_count >= item_count:
        return "已完成"
    return f"待完成 {done_count}/{item_count}"
