from datetime import datetime

from pydantic import BaseModel, Field, computed_field


class EmployeeCreate(BaseModel):
    """管理员创建员工账号"""

    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(None, max_length=64)


class EmployeePasswordSet(BaseModel):
    """管理员重置员工登录密码"""

    password: str = Field(min_length=6, max_length=128)


class LoginBody(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """列表/详情：密码列为掩码，非明文。"""

    model_config = {"from_attributes": True}

    id: int
    username: str
    display_name: str | None = None
    role: str
    created_at: datetime | None = None
    last_login_at: datetime | None = None

    @computed_field
    def password(self) -> str:
        return "******"
