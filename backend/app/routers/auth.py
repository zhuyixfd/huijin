from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import LoginBody, TokenResponse, UserOut
from app.security import create_access_token, verify_password

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
def login(body: LoginBody, db: Session = Depends(get_db)):
    username = body.username.strip()
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    user.last_login_at = datetime.now()
    db.add(user)
    db.commit()
    token = create_access_token(user.id, user.username)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserOut)
def me(current: User = Depends(get_current_user)):
    return current
