"""生产案例：文字 + 图片上传，首页列表"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.permissions import PERM_ORDER_PROCESS
from app.models import CaseStudy, Customer, OrderItem
from app.models import User as UserModel
from app.schemas_business import CaseStudyListOut, CaseStudyRow

router = APIRouter()

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_CASES_DIR = _BACKEND_ROOT / "uploads" / "cases"
ALLOWED_SUFFIX = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_FILES = 16
MAX_BYTES = 8 * 1024 * 1024


def _ensure_upload_dir() -> None:
    UPLOAD_CASES_DIR.mkdir(parents=True, exist_ok=True)


def _safe_suffix(filename: str) -> str:
    suf = Path(filename).suffix.lower()
    return suf if suf in ALLOWED_SUFFIX else ".bin"


def _row_to_case_study_out(cs: CaseStudy, order_no: str, customer_name: str) -> CaseStudyRow:
    imgs = list(cs.images) if isinstance(cs.images, list) else []
    return CaseStudyRow(
        id=cs.id,
        order_item_id=cs.order_item_id,
        order_no=order_no,
        customer_name=customer_name,
        unit_index=cs.unit_index,
        note=cs.note,
        images=[str(x) for x in imgs],
        created_at=cs.created_at,
    )


def _parse_unit_index(raw: str | None) -> int | None:
    if raw in (None, "", "null"):
        return None
    try:
        ui = int(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="unit_index 无效")
    if ui < 0:
        raise HTTPException(status_code=400, detail="unit_index 无效")
    return ui


async def _save_upload_files(upload_list: list[UploadFile]) -> list[str]:
    _ensure_upload_dir()
    saved_paths: list[str] = []
    for uf in upload_list[:MAX_FILES]:
        if not uf.filename:
            continue
        raw = await uf.read()
        if len(raw) > MAX_BYTES:
            raise HTTPException(status_code=400, detail=f"单文件过大（>{MAX_BYTES // 1024 // 1024}MB）")
        ext = _safe_suffix(uf.filename)
        name = f"{uuid.uuid4().hex}{ext}"
        dest = UPLOAD_CASES_DIR / name
        dest.write_bytes(raw)
        saved_paths.append(f"/uploads/cases/{name}")
    return saved_paths


def _delete_upload_files(paths: list[str]) -> None:
    base_dir = UPLOAD_CASES_DIR.resolve()
    for raw_path in paths:
        rel = str(raw_path or "").strip()
        if not rel.startswith("/uploads/cases/"):
            continue
        dest = (_BACKEND_ROOT / rel.lstrip("/\\")).resolve()
        try:
            dest.relative_to(base_dir)
        except ValueError:
            continue
        if dest.is_file():
            dest.unlink(missing_ok=True)


@router.get("", response_model=CaseStudyListOut)
def list_case_studies(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20,
    order_item_id: int | None = None,
    unit_index: int | None = None,
):
    limit = min(max(limit, 1), 100)
    count_stmt = select(func.count(CaseStudy.id))
    stmt = (
        select(CaseStudy, OrderItem.order_no, Customer.name)
        .join(OrderItem, CaseStudy.order_item_id == OrderItem.id)
        .join(Customer, OrderItem.customer_id == Customer.id)
    )
    if order_item_id is not None:
        count_stmt = count_stmt.where(CaseStudy.order_item_id == order_item_id)
        stmt = stmt.where(CaseStudy.order_item_id == order_item_id)
    if unit_index is not None:
        count_stmt = count_stmt.where(CaseStudy.unit_index == unit_index)
        stmt = stmt.where(CaseStudy.unit_index == unit_index)
    total = int(db.scalar(count_stmt) or 0)
    stmt = stmt.order_by(CaseStudy.created_at.desc()).offset(skip).limit(limit)
    rows = db.execute(stmt).all()
    items = [_row_to_case_study_out(cs, order_no, cust_name) for cs, order_no, cust_name in rows]
    return CaseStudyListOut(items=items, total=total)


@router.post("", response_model=CaseStudyRow, status_code=status.HTTP_201_CREATED)
async def create_case_study(
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
    order_item_id: int = Form(),
    note: str = Form(""),
    unit_index: str | None = Form(None),
    files: Annotated[list[UploadFile] | None, File()] = None,
):
    row = db.get(OrderItem, order_item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")

    upload_list = [f for f in (files or []) if getattr(f, "filename", None)]
    note_clean = (note or "").strip()
    if not note_clean and not upload_list:
        raise HTTPException(status_code=400, detail="请填写备注或上传至少一张图片")

    ui = _parse_unit_index(unit_index)
    saved_paths = await _save_upload_files(upload_list)

    cs = CaseStudy(
        order_item_id=order_item_id,
        unit_index=ui,
        note=note_clean or None,
        images=saved_paths if saved_paths else None,
    )
    db.add(cs)
    db.commit()
    db.refresh(cs)

    cust = db.get(Customer, row.customer_id)
    assert cust is not None
    return _row_to_case_study_out(cs, row.order_no, cust.name)


@router.put("/{case_id}", response_model=CaseStudyRow)
async def update_case_study(
    case_id: int,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
    note: str = Form(""),
    keep_images: str | None = Form(None),
    files: Annotated[list[UploadFile] | None, File()] = None,
):
    cs = db.get(CaseStudy, case_id)
    if cs is None:
        raise HTTPException(status_code=404, detail="案例不存在")

    row = db.get(OrderItem, cs.order_item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="明细不存在")
    cust = db.get(Customer, row.customer_id)
    assert cust is not None

    current_images = [str(x) for x in (cs.images or []) if isinstance(x, str)]
    if keep_images in (None, ""):
        kept_images = current_images
    else:
        try:
            parsed = json.loads(keep_images)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="keep_images 无效")
        if not isinstance(parsed, list) or any(not isinstance(x, str) for x in parsed):
            raise HTTPException(status_code=400, detail="keep_images 无效")
        allowed = set(current_images)
        invalid = [x for x in parsed if x not in allowed]
        if invalid:
            raise HTTPException(status_code=400, detail="keep_images 包含无效图片")
        kept_images = [str(x) for x in parsed]

    upload_list = [f for f in (files or []) if getattr(f, "filename", None)]
    note_clean = (note or "").strip()
    if not note_clean and not kept_images and not upload_list:
        raise HTTPException(status_code=400, detail="请填写备注或保留至少一张图片")

    new_paths = await _save_upload_files(upload_list)
    removed_paths = [p for p in current_images if p not in set(kept_images)]

    cs.note = note_clean or None
    cs.images = kept_images + new_paths if kept_images or new_paths else None
    db.add(cs)
    db.commit()
    db.refresh(cs)

    _delete_upload_files(removed_paths)
    return _row_to_case_study_out(cs, row.order_no, cust.name)


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case_study(
    case_id: int,
    _: UserModel = Depends(require_permission(PERM_ORDER_PROCESS)),
    db: Session = Depends(get_db),
):
    cs = db.get(CaseStudy, case_id)
    if cs is None:
        raise HTTPException(status_code=404, detail="案例不存在")

    image_paths = [str(x) for x in (cs.images or []) if isinstance(x, str)]
    db.delete(cs)
    db.commit()
    _delete_upload_files(image_paths)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
