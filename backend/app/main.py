from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.bootstrap import init_db
from app.database import engine
from app.routers import auth as auth_router
from app.routers import customers as customers_router
from app.routers import dashboard as dashboard_router
from app.routers import meta as meta_router
from app.routers import order_items as order_items_router
from app.routers import orders as orders_router
from app.routers import tasks as tasks_router
from app.routers import users as users_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="汇金特材 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router.router, prefix="/api/users", tags=["users"])
app.include_router(customers_router.router, prefix="/api/customers", tags=["customers"])
app.include_router(orders_router.router, prefix="/api/orders", tags=["orders"])
app.include_router(order_items_router.router, prefix="/api/order-items", tags=["order-items"])
app.include_router(tasks_router.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(dashboard_router.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(meta_router.router, prefix="/api/meta", tags=["meta"])


@app.get("/health")
def health():
    db_ok = False
    db_error = None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except SQLAlchemyError as e:
        db_error = str(e)
    return {
        "status": "ok",
        "database": {"ok": db_ok, "error": db_error},
    }


@app.get("/api/hello")
def hello():
    return {"message": "Hello from FastAPI", "app": "汇金特材"}
