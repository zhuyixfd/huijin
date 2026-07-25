from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db_backup import (
    BackupInfo,
    create_backup,
    list_backups,
    previous_evening_backup,
    restore_from_file,
    restore_previous_evening,
)
from app.deps import require_admin
from app.models import User as UserModel
from pathlib import Path

router = APIRouter()


class BackupOut(BaseModel):
    filename: str
    size_bytes: int
    created_at: str
    backup_date: str | None = None
    is_evening: bool
    label: str


class BackupStatusOut(BaseModel):
    backups: list[BackupOut]
    previous_evening: BackupOut | None = None


class RestoreOut(BaseModel):
    ok: bool
    message: str
    restored: BackupOut | None = None


def _to_out(info: BackupInfo) -> BackupOut:
    return BackupOut(
        filename=info.filename,
        size_bytes=info.size_bytes,
        created_at=info.created_at,
        backup_date=info.backup_date,
        is_evening=info.is_evening,
        label=info.label,
    )


@router.get("/status", response_model=BackupStatusOut)
def backup_status(_: UserModel = Depends(require_admin)):
    items = [_to_out(x) for x in list_backups()]
    prev = previous_evening_backup()
    return BackupStatusOut(
        backups=items,
        previous_evening=_to_out(prev) if prev else None,
    )


@router.post("/run", response_model=BackupOut)
def run_backup_now(_: UserModel = Depends(require_admin)):
    try:
        info = create_backup(evening=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _to_out(info)


@router.post("/restore-previous-evening", response_model=RestoreOut)
def restore_prev_evening(_: UserModel = Depends(require_admin)):
    try:
        info = restore_previous_evening()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return RestoreOut(
        ok=True,
        message=f"已恢复到：{info.label}",
        restored=_to_out(info),
    )


class RestoreFileBody(BaseModel):
    filename: str


@router.post("/restore-file", response_model=RestoreOut)
def restore_file(body: RestoreFileBody, _: UserModel = Depends(require_admin)):
    name = Path(body.filename).name
    if name != body.filename or "/" in body.filename or "\\" in body.filename:
        raise HTTPException(status_code=400, detail="非法文件名")
    matches = [b for b in list_backups() if b.filename == name]
    if not matches:
        raise HTTPException(status_code=404, detail="备份不存在")
    try:
        restore_from_file(Path(matches[0].path))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return RestoreOut(
        ok=True,
        message=f"已恢复到：{matches[0].label}",
        restored=_to_out(matches[0]),
    )
