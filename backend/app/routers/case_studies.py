"""生产案例：文字 + 图片上传，首页列表"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
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


@router.get("", response_model=CaseStudyListOut)
def list_case_studies(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20,
):
    limit = min(max(limit, 1), 100)
    total = int(db.scalar(select(func.count(CaseStudy.id))) or 0)
    stmt = (
        select(CaseStudy, OrderItem.order_no, Customer.name)
        .join(OrderItem, CaseStudy.order_item_id == OrderItem.id)
        .join(Customer, OrderItem.customer_id == Customer.id)
        .order_by(CaseStudy.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    items: list[CaseStudyRow] = []
    for cs, order_no, cust_name in rows:
        imgs = list(cs.images) if isinstance(cs.images, list) else []
        items.append(
            CaseStudyRow(
                id=cs.id,
                order_item_id=cs.order_item_id,
                order_no=order_no,
                customer_name=cust_name,
                unit_index=cs.unit_index,
                note=cs.note,
                images=[str(x) for x in imgs],
                created_at=cs.created_at,
            )
        )
    return CaseStudyListOut(items=items, total=total)


@router.post("", response_model=CaseStudyRow, status_code=status.HTTP_201_CREATED)
async def create_case_study(
    _: UserModel = Depends(get_current_user),
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

    ui: int | None = None
    if unit_index not in (None, "", "null"):
        try:
            ui = int(unit_index)
        except ValueError:
            raise HTTPException(status_code=400, detail="unit_index 无效")
        if ui < 0:
            raise HTTPException(status_code=400, detail="unit_index 无效")

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
    return CaseStudyRow(
        id=cs.id,
        order_item_id=cs.order_item_id,
        order_no=row.order_no,
        customer_name=cust.name,
        unit_index=cs.unit_index,
        note=cs.note,
        images=list(cs.images or []),
        created_at=cs.created_at,
    )
