from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
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
    Base.metadata.create_all(bind=engine)
    ensure_users_role_column()
    ensure_user_profile_columns()
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()
