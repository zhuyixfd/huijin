from datetime import datetime

from pydantic import BaseModel, Field


class EmployeeCreate(BaseModel):
    """管理员创建员工账号"""

    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class LoginBody(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    username: str
    role: str
    created_at: datetime | None = None
