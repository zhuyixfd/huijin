from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import User
from app.schemas import EmployeeCreate, EmployeePasswordSet, UserOut
from app.security import hash_password

router = APIRouter()


@router.get("", response_model=list[UserOut])
def list_users(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return list(db.scalars(select(User).order_by(User.id)).all())


@router.post("/employees", response_model=UserOut)
def create_employee(
    body: EmployeeCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    dn = body.display_name.strip() if body.display_name else None
    user = User(
        username=body.username.strip(),
        password_hash=hash_password(body.password),
        display_name=dn,
        role="employee",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在",
        ) from None
    db.refresh(user)
    return user


@router.patch("/{user_id}/password", response_model=UserOut)
def set_employee_password(
    user_id: int,
    body: EmployeePasswordSet,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """仅允许将员工账号的密码重置为新密码。"""
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if u.role != "employee":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="仅可修改员工账号的密码",
        )
    u.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(u)
    return u
