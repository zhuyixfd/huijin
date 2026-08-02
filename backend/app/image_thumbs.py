"""案例图缩略图：首页列表用小图，点击看原图。"""

from __future__ import annotations

import logging
from pathlib import Path

from app.paths import UPLOAD_ROOT

logger = logging.getLogger(__name__)

# 列表展示宽度约 12rem，2x 屏约 400px 足够
_THUMB_MAX_EDGE = 480
_THUMB_QUALITY = 78


def upload_fs_path(rel_url: str) -> Path | None:
    """`/uploads/cases/xxx.jpg` → UPLOAD_ROOT/cases/xxx.jpg"""
    rel = str(rel_url or "").strip().replace("\\", "/")
    if not rel.startswith("/uploads/"):
        return None
    parts = Path(rel[len("/uploads/") :])
    if parts.is_absolute() or ".." in parts.parts:
        return None
    return (UPLOAD_ROOT / parts).resolve()


def thumb_rel_url(original_rel: str) -> str:
    """`/uploads/cases/abc.png` → `/uploads/cases/abc_thumb.jpg`"""
    rel = str(original_rel or "").strip().replace("\\", "/")
    p = Path(rel)
    parent = p.parent.as_posix().rstrip("/")
    return f"{parent}/{p.stem}_thumb.jpg"


def ensure_image_thumb(original_rel: str) -> str:
    """若缩略图不存在则生成；失败则退回原图路径。"""
    src = upload_fs_path(original_rel)
    if src is None or not src.is_file():
        return original_rel
    thumb_rel = thumb_rel_url(original_rel)
    dest = upload_fs_path(thumb_rel)
    if dest is None:
        return original_rel
    if dest.is_file() and dest.stat().st_mtime >= src.stat().st_mtime:
        return thumb_rel
    try:
        from PIL import Image, ImageOps

        dest.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            elif im.mode == "L":
                im = im.convert("RGB")
            im.thumbnail((_THUMB_MAX_EDGE, _THUMB_MAX_EDGE), Image.Resampling.LANCZOS)
            im.save(dest, format="JPEG", quality=_THUMB_QUALITY, optimize=True)
        return thumb_rel
    except Exception:
        logger.exception("生成缩略图失败：%s", original_rel)
        return original_rel


def ensure_image_thumbs(originals: list[str]) -> list[str]:
    return [ensure_image_thumb(x) for x in originals]


def delete_image_and_thumb(original_rel: str) -> None:
    for rel in (original_rel, thumb_rel_url(original_rel)):
        path = upload_fs_path(rel)
        if path is not None and path.is_file():
            path.unlink(missing_ok=True)
