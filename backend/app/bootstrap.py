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
    ensure_order_item_processing_unit_codes_col()
    ensure_grind_log_unit_index()
    ensure_order_item_in_today_queue()
    drop_order_item_legacy_production_columns()
    ensure_user_permission_codes_column()
    ensure_order_item_remark_images()
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()
