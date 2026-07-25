"""操作审计：记录时间、操作人、IP、请求路径与摘要。"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any

from fastapi import Request, Response
from sqlalchemy import delete
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

from app.database import SessionLocal
from app.models import OperationLog, User
from app.security import decode_token

logger = logging.getLogger(__name__)

_BODY_MAX = 4000
_RETENTION_DAYS = 90
_SENSITIVE_KEYS = re.compile(
    r"(password|passwd|pwd|token|secret|authorization|access_token|refresh_token)",
    re.I,
)

# 仅记录写操作；列表轮询等 GET 不记，避免刷爆
_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

_SKIP_PREFIXES = (
    "/health",
    "/uploads",
    "/docs",
    "/openapi",
    "/redoc",
)

_SKIP_EXACT = frozenset(
    {
        "/api/hello",
        "/api/audit-logs",  # 查日志本身不记，避免自递归噪音
    }
)

# 路径 → 中文操作名（按匹配优先级，长路径在前）
_ACTION_RULES: list[tuple[re.Pattern[str], str, str]] = [
    # (method_regex, path_regex, label)
    (re.compile(r"^POST$"), re.compile(r"^/api/auth/login$"), "登录"),
    (re.compile(r"^POST$"), re.compile(r"^/api/order-items/batch-processing-codes$"), "件号重排"),
    (re.compile(r"^POST$"), re.compile(r"^/api/order-items/batch-ensure-processing-codes$"), "件号补齐"),
    (re.compile(r"^POST$"), re.compile(r"^/api/order-items/batch-production-status$"), "批量改生产状态"),
    (re.compile(r"^PATCH$"), re.compile(r"^/api/order-items/\d+/unit-production-statuses$"), "逐支改生产状态"),
    (re.compile(r"^PATCH$"), re.compile(r"^/api/order-items/\d+/sync-common$"), "同步同源明细"),
    (re.compile(r"^POST$"), re.compile(r"^/api/order-items/\d+/remark-images$"), "上传备注图片"),
    (re.compile(r"^POST$"), re.compile(r"^/api/order-items/\d+/incoming-sheet-images$"), "上传来料单图片"),
    (re.compile(r"^PATCH$"), re.compile(r"^/api/order-items/\d+$"), "修改订单明细"),
    (re.compile(r"^POST$"), re.compile(r"^/api/order-items"), "新建订单明细"),
    (re.compile(r"^DELETE$"), re.compile(r"^/api/order-items/\d+$"), "删除订单明细"),
    (re.compile(r"^POST$"), re.compile(r"^/api/orders$"), "新建订单"),
    (re.compile(r"^PATCH$"), re.compile(r"^/api/orders/\d+$"), "修改订单"),
    (re.compile(r"^DELETE$"), re.compile(r"^/api/orders/\d+$"), "删除订单"),
    (re.compile(r"^POST$"), re.compile(r"^/api/tasks/work-orders$"), "创建工单/开始处理"),
    (re.compile(r"^POST$"), re.compile(r"^/api/tasks/split-order$"), "拆分订单"),
    (re.compile(r"^POST$"), re.compile(r"^/api/tasks/cut-head-logs$"), "记录剁料头"),
    (re.compile(r"^DELETE$"), re.compile(r"^/api/tasks/items/\d+$"), "删除任务明细"),
    (re.compile(r"^POST$"), re.compile(r"^/api/backups/run$"), "手动备份数据库"),
    (re.compile(r"^POST$"), re.compile(r"^/api/backups/restore"), "恢复数据库备份"),
    (re.compile(r"^POST$"), re.compile(r"^/api/users/employees$"), "新建员工帐号"),
    (re.compile(r"^PATCH$"), re.compile(r"^/api/users/\d+/password$"), "修改员工密码"),
    (re.compile(r"^PATCH$"), re.compile(r"^/api/users/\d+/permissions$"), "修改员工权限"),
    (re.compile(r"^POST$"), re.compile(r"^/api/customers$"), "新建客户"),
    (re.compile(r"^PATCH$"), re.compile(r"^/api/customers/\d+$"), "修改客户"),
    (re.compile(r"^DELETE$"), re.compile(r"^/api/customers/\d+$"), "删除客户"),
    (re.compile(r"^POST$"), re.compile(r"^/api/case-studies$"), "新建案例"),
    (re.compile(r"^PUT$"), re.compile(r"^/api/case-studies/\d+$"), "修改案例"),
    (re.compile(r"^DELETE$"), re.compile(r"^/api/case-studies/\d+$"), "删除案例"),
]


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    real = request.headers.get("x-real-ip") or request.headers.get("X-Real-IP")
    if real:
        return real.strip()[:64]
    if request.client and request.client.host:
        return str(request.client.host)[:64]
    return ""


def action_label(method: str, path: str) -> str:
    for m_re, p_re, label in _ACTION_RULES:
        if m_re.match(method) and p_re.match(path):
            return label
    return f"{method} {path}"


def _redact_obj(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if _SENSITIVE_KEYS.search(str(k)):
                out[k] = "***"
            else:
                out[k] = _redact_obj(v)
        return out
    if isinstance(obj, list):
        return [_redact_obj(x) for x in obj[:50]]
    return obj


def summarize_body(raw: bytes | None, content_type: str | None) -> str | None:
    if not raw:
        return None
    ct = (content_type or "").lower()
    if "multipart/form-data" in ct:
        return f"[multipart {len(raw)} bytes]"
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        return f"[binary {len(raw)} bytes]"
    text = text.strip()
    if not text:
        return None
    if "application/json" in ct or text[:1] in "{[":
        try:
            data = json.loads(text)
            text = json.dumps(_redact_obj(data), ensure_ascii=False, separators=(",", ":"))
        except Exception:
            text = _SENSITIVE_KEYS.sub(r"\1:***", text)
    else:
        text = _SENSITIVE_KEYS.sub(r"\1:***", text)
    if len(text) > _BODY_MAX:
        return text[:_BODY_MAX] + "…(截断)"
    return text


def _user_from_auth_header(authorization: str | None, db: Session) -> tuple[int | None, str | None, str | None]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None, None, None
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    if not payload:
        return None, None, None
    username = payload.get("username")
    try:
        uid = int(payload.get("sub", ""))
    except (TypeError, ValueError):
        return None, str(username) if username else None, None
    user = db.get(User, uid)
    if user is None:
        return uid, str(username) if username else None, None
    return user.id, user.username, user.display_name


def _username_hint_from_body(body_summary: str | None) -> str | None:
    if not body_summary:
        return None
    try:
        data = json.loads(body_summary)
        if isinstance(data, dict) and data.get("username"):
            return str(data["username"])[:64]
    except Exception:
        pass
    return None


def should_audit(method: str, path: str) -> bool:
    if not path.startswith("/api/"):
        return False
    for p in _SKIP_PREFIXES:
        if path.startswith(p):
            return False
    if path.rstrip("/") in _SKIP_EXACT or path in _SKIP_EXACT:
        return False
    # 查操作日志、界面偏好不记
    if path.startswith("/api/audit-logs"):
        return False
    if "/ui-prefs/" in path:
        return False
    return method.upper() in _WRITE_METHODS


def write_operation_log(
    *,
    user_id: int | None,
    username: str | None,
    display_name: str | None,
    ip: str | None,
    method: str,
    path: str,
    query_string: str | None,
    action: str,
    status_code: int | None,
    duration_ms: int | None,
    request_body: str | None,
    user_agent: str | None,
) -> None:
    db = SessionLocal()
    try:
        row = OperationLog(
            user_id=user_id,
            username=username,
            display_name=display_name,
            ip=(ip or None),
            method=method[:16],
            path=path[:512],
            query_string=(query_string[:1024] if query_string else None),
            action=action[:128],
            status_code=status_code,
            duration_ms=duration_ms,
            request_body=request_body,
            user_agent=(user_agent[:512] if user_agent else None),
        )
        db.add(row)
        db.commit()
        # 偶尔清理过期日志（约每 50 次写入抽一次，用 id 取模近似）
        if row.id and row.id % 50 == 0:
            cutoff = datetime.now() - timedelta(days=_RETENTION_DAYS)
            db.execute(delete(OperationLog).where(OperationLog.created_at < cutoff))
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("写入操作日志失败")
    finally:
        db.close()


class OperationAuditMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        method = request.method.upper()
        path = request.url.path
        if not should_audit(method, path):
            return await call_next(request)

        raw_body = await request.body()

        async def receive():
            return {"type": "http.request", "body": raw_body, "more_body": False}

        request = Request(request.scope, receive)

        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_ms = int((time.perf_counter() - started) * 1000)
            body_summary = summarize_body(raw_body, request.headers.get("content-type"))
            ip = client_ip(request)
            ua = request.headers.get("user-agent")
            qs = request.url.query or None
            action = action_label(method, path)

            user_id = username = display_name = None
            db = SessionLocal()
            try:
                user_id, username, display_name = _user_from_auth_header(
                    request.headers.get("authorization"), db
                )
            finally:
                db.close()

            if not username and path.rstrip("/").endswith("/auth/login"):
                username = _username_hint_from_body(body_summary)

            try:
                write_operation_log(
                    user_id=user_id,
                    username=username,
                    display_name=display_name,
                    ip=ip,
                    method=method,
                    path=path,
                    query_string=qs,
                    action=action,
                    status_code=status_code,
                    duration_ms=duration_ms,
                    request_body=body_summary,
                    user_agent=ua,
                )
            except Exception:
                logger.exception("操作审计中间件写库失败")
