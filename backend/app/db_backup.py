"""数据库定时备份与恢复（MySQL：mysqldump 导出为 .sql 文件）。"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from app.config import settings
from app.database import engine

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", str(_BACKEND_ROOT / "backups")))
RETENTION_DAYS = 14

# 定时备份文件名：huijin_tecai_YYYYMMDD_2000.sql
_EVENING_RE = re.compile(r"^(.+)_(\d{8})_2000\.sql$")
_last_evening_backup_date: date | None = None


@dataclass
class BackupInfo:
    filename: str
    path: str
    size_bytes: int
    created_at: str
    backup_date: str | None
    is_evening: bool
    label: str


def ensure_backup_dir() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return BACKUP_DIR


def _mysql_env() -> dict[str, str]:
    env = os.environ.copy()
    env["MYSQL_PWD"] = settings.mysql_password or ""
    return env


def _require_bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"未找到命令「{name}」，请先安装 MySQL 客户端工具（含 mysqldump / mysql）")
    return path


def evening_backup_filename(d: date | None = None) -> str:
    day = d or date.today()
    return f"{settings.mysql_database}_{day.strftime('%Y%m%d')}_2000.sql"


def evening_backup_path(d: date | None = None) -> Path:
    return ensure_backup_dir() / evening_backup_filename(d)


def create_backup(*, evening: bool = False, when: datetime | None = None) -> BackupInfo:
    """导出整库到 backups/。evening=True 时使用固定晚 8 点文件名（同日覆盖）。"""
    ensure_backup_dir()
    dump_bin = _require_bin("mysqldump")
    now = when or datetime.now()
    if evening:
        out = evening_backup_path(now.date())
    else:
        out = ensure_backup_dir() / f"{settings.mysql_database}_{now.strftime('%Y%m%d_%H%M%S')}.sql"

    cmd = [
        dump_bin,
        f"--host={settings.mysql_host}",
        f"--port={str(settings.mysql_port)}",
        f"--user={settings.mysql_user}",
        "--single-transaction",
        "--routines",
        "--triggers",
        "--default-character-set=utf8mb4",
        "--result-file=" + str(out),
        settings.mysql_database,
    ]
    proc = subprocess.run(
        cmd,
        env=_mysql_env(),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
        if out.exists() and out.stat().st_size == 0:
            out.unlink(missing_ok=True)
        raise RuntimeError(f"备份失败：{err}")
    if not out.exists() or out.stat().st_size == 0:
        raise RuntimeError("备份失败：未生成有效备份文件")
    prune_old_backups()
    return backup_info_from_path(out)


def backup_info_from_path(path: Path) -> BackupInfo:
    name = path.name
    m = _EVENING_RE.match(name)
    is_evening = m is not None
    backup_date = None
    label = name
    if m:
        backup_date = f"{m.group(2)[0:4]}-{m.group(2)[4:6]}-{m.group(2)[6:8]}"
        label = f"{backup_date} 20:00 定时备份"
    else:
        stamp = path.stat().st_mtime
        label = f"手动备份 · {datetime.fromtimestamp(stamp).strftime('%Y-%m-%d %H:%M:%S')}"
    return BackupInfo(
        filename=name,
        path=str(path),
        size_bytes=int(path.stat().st_size),
        created_at=datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds"),
        backup_date=backup_date,
        is_evening=is_evening,
        label=label,
    )


def list_backups() -> list[BackupInfo]:
    ensure_backup_dir()
    items: list[BackupInfo] = []
    for p in BACKUP_DIR.glob(f"{settings.mysql_database}_*.sql"):
        if not p.is_file():
            continue
        try:
            items.append(backup_info_from_path(p))
        except OSError:
            continue
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


def previous_evening_backup(today: date | None = None) -> BackupInfo | None:
    """头一天晚上 8 点的备份；若不存在则回退到更早的最近一份晚 8 点备份。"""
    day = today or date.today()
    for i in range(1, RETENTION_DAYS + 3):
        d = day - timedelta(days=i)
        p = evening_backup_path(d)
        if p.is_file() and p.stat().st_size > 0:
            return backup_info_from_path(p)
    return None


def prune_old_backups() -> None:
    ensure_backup_dir()
    cutoff = date.today() - timedelta(days=RETENTION_DAYS)
    for p in BACKUP_DIR.glob(f"{settings.mysql_database}_*.sql"):
        m = _EVENING_RE.match(p.name)
        if m:
            try:
                d = datetime.strptime(m.group(2), "%Y%m%d").date()
            except ValueError:
                continue
            if d < cutoff:
                p.unlink(missing_ok=True)
            continue
        # 手动备份：按修改时间清理
        try:
            mtime = datetime.fromtimestamp(p.stat().st_mtime).date()
        except OSError:
            continue
        if mtime < cutoff:
            p.unlink(missing_ok=True)


def restore_from_file(path: Path) -> None:
    """用指定 .sql 覆盖当前库（危险操作）。"""
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("备份文件不存在或为空")
    mysql_bin = _require_bin("mysql")
    # 断开连接池，避免恢复过程中占用表
    engine.dispose()
    cmd = [
        mysql_bin,
        f"--host={settings.mysql_host}",
        f"--port={str(settings.mysql_port)}",
        f"--user={settings.mysql_user}",
        "--default-character-set=utf8mb4",
        settings.mysql_database,
    ]
    with path.open("rb") as f:
        proc = subprocess.run(
            cmd,
            env=_mysql_env(),
            stdin=f,
            capture_output=True,
            text=True,
            check=False,
        )
    engine.dispose()
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"恢复失败：{err}")


def restore_previous_evening() -> BackupInfo:
    info = previous_evening_backup()
    if info is None:
        raise RuntimeError("没有可用的「头一天晚上 20:00」备份，请确认定时备份是否已跑过")
    restore_from_file(Path(info.path))
    return info


def run_scheduled_evening_backup_if_due(now: datetime | None = None) -> BackupInfo | None:
    """若当前为 20:00～20:02 且今日晚备尚未完成，则执行一次。"""
    global _last_evening_backup_date
    now = now or datetime.now()
    if now.hour != 20 or now.minute > 2:
        return None
    if _last_evening_backup_date == now.date():
        return None
    out = evening_backup_path(now.date())
    if out.is_file() and out.stat().st_size > 0:
        mtime = datetime.fromtimestamp(out.stat().st_mtime)
        if mtime.date() == now.date() and mtime.hour == 20:
            _last_evening_backup_date = now.date()
            return None
    logger.info("开始执行每日 20:00 数据库备份 → %s", out.name)
    info = create_backup(evening=True, when=now)
    _last_evening_backup_date = now.date()
    return info
