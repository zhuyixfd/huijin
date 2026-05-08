"""订单层展示状态（由多条来料明细聚合）。"""

ITEM_DONE = "已发回"
ITEM_WAIT_WAREHOUSE = "未入库"


def format_single_line_item_order_status(production_status: str) -> str:
    """单行来料时订单状态列；生产状态「待发回」在界面上显示为「待出库」。"""
    if production_status == "待发回":
        return "待出库"
    cnt = 1
    done_n = 1 if production_status == "已发回" else 0
    wait_n = 1 if production_status == "未入库" else 0
    return format_order_status_display(cnt, done_n, wait_n)


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
