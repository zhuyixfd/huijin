"""将旧库 orders + order_items(order_id) 迁到单行订单（order_items 含 customer_id、order_no 等）并删除 orders 表。"""

from sqlalchemy import inspect, text

from app.database import engine


def _drop_order_fks(conn) -> None:
    ic = inspect(conn)
    for fk in ic.get_foreign_keys("order_items"):
        ccols = fk.get("constrained_columns") or []
        if fk.get("referred_table") == "orders" or "order_id" in ccols:
            name = fk.get("name")
            if name:
                conn.execute(text(f"ALTER TABLE order_items DROP FOREIGN KEY `{name}`"))


def migrate_orders_flatten() -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    if "order_items" not in tables:
        return

    with engine.begin() as conn:
        ic = inspect(conn)
        tables_now = set(ic.get_table_names())
        cols = {c["name"] for c in ic.get_columns("order_items")}

        if "orders" in tables_now:
            if "order_no" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE order_items ADD COLUMN order_no VARCHAR(64) NULL "
                        "COMMENT '订单编号'"
                    )
                )
            if "customer_id" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE order_items ADD COLUMN customer_id INT NULL "
                        "COMMENT '客户'"
                    )
                )
            if "created_at" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE order_items ADD COLUMN created_at DATETIME NULL "
                        "DEFAULT CURRENT_TIMESTAMP"
                    )
                )
            if "order_remark" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE order_items ADD COLUMN order_remark TEXT NULL "
                        "COMMENT '订单备注'"
                    )
                )

            # MySQL 1093：不能在 UPDATE order_items 的子查询里再读同一表；先用临时表算每个 order_id 行数
            conn.execute(
                text(
                    """
                    CREATE TEMPORARY TABLE _hj_migrate_order_counts (
                      order_id INT NOT NULL PRIMARY KEY,
                      cnt INT NOT NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO _hj_migrate_order_counts (order_id, cnt)
                    SELECT order_id, COUNT(*) FROM order_items GROUP BY order_id
                    """
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE order_items AS oi
                    INNER JOIN orders AS o ON oi.order_id = o.id
                    INNER JOIN _hj_migrate_order_counts AS oc ON oc.order_id = oi.order_id
                    SET
                      oi.customer_id = o.customer_id,
                      oi.created_at = o.created_at,
                      oi.order_remark = o.remark,
                      oi.order_no = IF(
                        oc.cnt > 1,
                        CONCAT(o.order_no, '-', oi.id),
                        o.order_no
                      )
                    """
                )
            )
            conn.execute(text("DROP TEMPORARY TABLE IF EXISTS _hj_migrate_order_counts"))

            _drop_order_fks(conn)

            ic2 = inspect(conn)
            if "order_id" in {c["name"] for c in ic2.get_columns("order_items")}:
                conn.execute(text("ALTER TABLE order_items DROP COLUMN order_id"))

            conn.execute(text("DROP TABLE IF EXISTS orders"))

            # 无法关联到原 orders 的孤儿行，避免 NOT NULL 失败
            conn.execute(
                text("DELETE FROM order_items WHERE customer_id IS NULL OR order_no IS NULL")
            )

            conn.execute(
                text("UPDATE order_items SET created_at = NOW() WHERE created_at IS NULL")
            )
            conn.execute(
                text("ALTER TABLE order_items MODIFY COLUMN order_no VARCHAR(64) NOT NULL")
            )
            conn.execute(
                text("ALTER TABLE order_items MODIFY COLUMN customer_id INT NOT NULL")
            )
            conn.execute(
                text(
                    "ALTER TABLE order_items MODIFY COLUMN created_at DATETIME NOT NULL "
                    "DEFAULT CURRENT_TIMESTAMP"
                )
            )

            try:
                conn.execute(
                    text("ALTER TABLE order_items ADD UNIQUE KEY uq_order_no (order_no)")
                )
            except Exception:
                pass

        else:
            ic3 = inspect(conn)
            col_names = {c["name"] for c in ic3.get_columns("order_items")}
            if "order_id" in col_names:
                _drop_order_fks(conn)
                conn.execute(text("ALTER TABLE order_items DROP COLUMN order_id"))
