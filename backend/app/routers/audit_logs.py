from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import OperationLog, User as UserModel

router = APIRouter()


class OperationLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    user_id: int | None = None
    username: str | None = None
    display_name: str | None = None
    ip: str | None = None
    method: str
    path: str
    query_string: str | None = None
    action: str
    status_code: int | None = None
    duration_ms: int | None = None
    request_body: str | None = None
    user_agent: str | None = None


class OperationLogPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[OperationLogOut]


@router.get("", response_model=OperationLogPage)
def list_operation_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    username: str | None = Query(None, description="按用户名筛选"),
    action: str | None = Query(None, description="操作名模糊匹配"),
    ip: str | None = Query(None),
    _: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = select(OperationLog)
    count_q = select(func.count()).select_from(OperationLog)
    if username:
        u = username.strip()
        q = q.where(OperationLog.username == u)
        count_q = count_q.where(OperationLog.username == u)
    if action:
        a = f"%{action.strip()}%"
        q = q.where(OperationLog.action.like(a))
        count_q = count_q.where(OperationLog.action.like(a))
    if ip:
        i = ip.strip()
        q = q.where(OperationLog.ip == i)
        count_q = count_q.where(OperationLog.ip == i)

    total = int(db.scalar(count_q) or 0)
    rows = db.scalars(
        q.order_by(OperationLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return OperationLogPage(
        total=total,
        page=page,
        page_size=page_size,
        items=[OperationLogOut.model_validate(r) for r in rows],
    )
