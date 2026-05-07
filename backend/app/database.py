from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

_pwd = quote_plus(settings.mysql_password)
DATABASE_URL = (
    f"mysql+pymysql://{settings.mysql_user}:{_pwd}"
    f"@{settings.mysql_host}:{settings.mysql_port}/{settings.mysql_database}"
    "?charset=utf8mb4"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
