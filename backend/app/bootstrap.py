from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.migrate_orders_flat import migrate_orders_flatten
from app.models import Base, User
from app.security import hash_password


def ensure_user_profile_columns() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("users")}
    with engine.begin() as conn:
        if "display_name" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN display_name VARCHAR(64) NULL"))
        if "last_login_at" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL"))


def ensure_order_item_processing_unit_codes_col() -> None:
    """order_items.processing_unit_codes：处理中单件折叠编号 JSON 数组"""
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "processing_unit_codes" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE order_items ADD COLUMN processing_unit_codes JSON NULL"
            )
        )


def ensure_grind_log_unit_index() -> None:
    inspector = inspect(engine)
    if "grind_logs" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("grind_logs")}
    if "unit_index" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE grind_logs ADD COLUMN unit_index INT NULL"))


def ensure_user_permission_codes_column() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "permission_codes" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN permission_codes JSON NULL"))


def ensure_order_item_remark_images() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "remark_images" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE order_items ADD COLUMN remark_images JSON NULL"))


def ensure_order_item_incoming_sheet_images() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "incoming_sheet_images" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE order_items ADD COLUMN incoming_sheet_images JSON NULL")
        )


def ensure_order_item_cut_head_weight() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "cut_head_weight" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE order_items ADD COLUMN cut_head_weight DECIMAL(18,3) NULL")
        )


def ensure_order_item_finished_outputs_table() -> None:
    inspector = inspect(engine)
    if "order_item_finished_outputs" in inspector.get_table_names():
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE order_item_finished_outputs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    order_item_id INT NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    piece_code VARCHAR(64) NULL,
                    spec VARCHAR(256) NULL,
                    formed_size VARCHAR(512) NULL,
                    pieces INT NULL,
                    weight_return DECIMAL(18,3) NULL,
                    return_date DATE NULL,
                    remark TEXT NULL,
                    INDEX ix_oifo_order_item_id (order_item_id),
                    CONSTRAINT fk_oifo_order_item
                        FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
                )
                """
            )
        )


def ensure_order_item_finished_outputs_return_date() -> None:
    inspector = inspect(engine)
    if "order_item_finished_outputs" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_item_finished_outputs")}
    if "return_date" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE order_item_finished_outputs ADD COLUMN return_date DATE NULL"))


def ensure_order_item_finished_outputs_pieces() -> None:
    inspector = inspect(engine)
    if "order_item_finished_outputs" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_item_finished_outputs")}
    if "pieces" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE order_item_finished_outputs ADD COLUMN pieces INT NULL")
        )


def ensure_order_item_finished_outputs_pieces_nullable() -> None:
    inspector = inspect(engine)
    if "order_item_finished_outputs" not in inspector.get_table_names():
        return
    cols = {c["name"]: c for c in inspector.get_columns("order_item_finished_outputs")}
    col = cols.get("pieces")
    if not col:
        return
    with engine.begin() as conn:
        if not bool(col.get("nullable")):
            conn.execute(text("ALTER TABLE order_item_finished_outputs MODIFY COLUMN pieces INT NULL"))
        conn.execute(text("ALTER TABLE order_item_finished_outputs ALTER pieces DROP DEFAULT"))


def ensure_order_item_incoming_quantity() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "incoming_quantity" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE order_items ADD COLUMN incoming_quantity INT NOT NULL DEFAULT 1")
        )


def ensure_order_item_quantity_nullable() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"]: c for c in inspector.get_columns("order_items")}
    col = cols.get("quantity")
    if not col:
        return
    with engine.begin() as conn:
        if not bool(col.get("nullable")):
            conn.execute(text("ALTER TABLE order_items MODIFY COLUMN quantity INT NULL"))
        conn.execute(text("ALTER TABLE order_items ALTER quantity DROP DEFAULT"))


def ensure_order_item_promised_return_date() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "promised_return_date" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE order_items ADD COLUMN promised_return_date DATE NULL"))
        conn.execute(
            text(
                "UPDATE order_items SET promised_return_date = return_date "
                "WHERE promised_return_date IS NULL AND return_date IS NOT NULL"
            )
        )


def ensure_order_item_returned_at() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "returned_at" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE order_items ADD COLUMN returned_at DATETIME NULL"))
        conn.execute(
            text(
                "UPDATE order_items SET returned_at = CONCAT(return_date, ' 00:00:00') "
                "WHERE returned_at IS NULL AND return_date IS NOT NULL AND production_status = '已发回'"
            )
        )


def ensure_order_item_unit_production_statuses() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "unit_production_statuses" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE order_items ADD COLUMN unit_production_statuses JSON NULL"))


def ensure_order_item_split_columns() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    adds: list[str] = []
    if "split_group_id" not in cols:
        adds.append("ADD COLUMN split_group_id VARCHAR(40) NULL")
    if "split_base_order_no" not in cols:
        adds.append("ADD COLUMN split_base_order_no VARCHAR(64) NULL")
    if "split_seq" not in cols:
        adds.append("ADD COLUMN split_seq INT NULL")
    if not adds:
        return
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE order_items {', '.join(adds)}"))


def ensure_order_item_production_status_v2() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "production_status" not in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE order_items SET production_status = '在库中' "
                "WHERE production_status IS NULL OR TRIM(production_status) = '' "
                "OR production_status IN ('未入库', '已入库')"
            )
        )
        if engine.dialect.name in ("mysql", "mariadb"):
            try:
                conn.execute(
                    text(
                        "ALTER TABLE order_items "
                        "MODIFY COLUMN production_status VARCHAR(32) NOT NULL DEFAULT '在库中'"
                    )
                )
            except Exception:
                pass


def drop_order_item_legacy_production_columns() -> None:
    """移除已废弃字段 production_no、production_process（ORM 已删除）。"""
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    drops: list[str] = []
    if "production_no" in cols:
        drops.append("DROP COLUMN production_no")
    if "production_process" in cols:
        drops.append("DROP COLUMN production_process")
    if not drops:
        return
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE order_items {', '.join(drops)}"))


def ensure_order_item_in_today_queue() -> None:
    """order_items.in_today_queue：处理中视图「今日处理」区块勾选"""
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "in_today_queue" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE order_items ADD COLUMN in_today_queue TINYINT(1) NOT NULL DEFAULT 0"
            )
        )


def ensure_order_item_in_tomorrow_queue() -> None:
    inspector = inspect(engine)
    if "order_items" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("order_items")}
    if "in_tomorrow_queue" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE order_items ADD COLUMN in_tomorrow_queue TINYINT(1) NOT NULL DEFAULT 0"
            )
        )


def ensure_customer_abbr_column() -> None:
    """旧库 customers 无 abbr 时补齐：U+id，唯一非空。"""
    inspector = inspect(engine)
    if "customers" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("customers")}
    if "abbr" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE customers ADD COLUMN abbr VARCHAR(32) NULL")
        )
        conn.execute(
            text(
                "UPDATE customers SET abbr = CONCAT('U', id) "
                "WHERE abbr IS NULL OR TRIM(abbr) = ''"
            )
        )
        conn.execute(text("ALTER TABLE customers MODIFY COLUMN abbr VARCHAR(32) NOT NULL"))
        try:
            conn.execute(
                text("ALTER TABLE customers ADD UNIQUE KEY uq_customers_abbr (abbr)")
            )
        except Exception:
            pass


def ensure_users_role_column() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "role" in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'employee'"
            )
        )


def seed_admin(db: Session) -> None:
    """初始管理员 admin / admin123：不存在则创建；若已有 admin 账号则保证角色为 admin。"""
    existing = db.scalar(select(User).where(User.username == "admin"))
    if existing is None:
        db.add(
            User(
                username="admin",
                password_hash=hash_password("admin123"),
                role="admin",
            )
        )
        db.commit()
        return
    if existing.role != "admin":
        existing.role = "admin"
        db.commit()


def init_db() -> None:
    migrate_orders_flatten()
    Base.metadata.create_all(bind=engine)
    ensure_users_role_column()
    ensure_user_profile_columns()
    ensure_customer_abbr_column()
    ensure_order_item_production_status_v2()
    ensure_order_item_processing_unit_codes_col()
    ensure_grind_log_unit_index()
    ensure_order_item_in_today_queue()
    ensure_order_item_in_tomorrow_queue()
    drop_order_item_legacy_production_columns()
    ensure_user_permission_codes_column()
    ensure_order_item_remark_images()
    ensure_order_item_incoming_sheet_images()
    ensure_order_item_cut_head_weight()
    ensure_order_item_incoming_quantity()
    ensure_order_item_quantity_nullable()
    ensure_order_item_promised_return_date()
    ensure_order_item_returned_at()
    ensure_order_item_unit_production_statuses()
    ensure_order_item_split_columns()
    ensure_order_item_finished_outputs_table()
    ensure_order_item_finished_outputs_return_date()
    ensure_order_item_finished_outputs_pieces()
    ensure_order_item_finished_outputs_pieces_nullable()
    db = SessionLocal()
    try:
        seed_admin(db)
        from app.order_item_finished import backfill_finished_outputs_from_items

        backfill_finished_outputs_from_items(db)
    finally:
        db.close()
