from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, computed_field, field_validator


class EmployeeCreate(BaseModel):
    """管理员创建员工账号"""

    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(None, max_length=64)
    permission_codes: list[str] | None = Field(
        default=None,
        description="业务权限码列表；不传或 null 表示与旧版一致（全部权限）",
    )

    @field_validator("permission_codes")
    @classmethod
    def validate_perm_codes(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        from app.permissions import ALL_PERMISSION_CODES

        out = [str(x) for x in v if x in ALL_PERMISSION_CODES]
        return out


class EmployeePermissionsUpdate(BaseModel):
    permission_codes: list[str] = Field(default_factory=list)

    @field_validator("permission_codes")
    @classmethod
    def validate_perm_codes(cls, v: list[str]) -> list[str]:
        from app.permissions import ALL_PERMISSION_CODES

        return [str(x) for x in v if x in ALL_PERMISSION_CODES]


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
    permission_codes: list[str] | None = None
    created_at: datetime | None = None
    last_login_at: datetime | None = None

    @computed_field
    def password(self) -> str:
        return "******"


class UiPrefUpsert(BaseModel):
    value: Any = None


class UiPrefOut(BaseModel):
    key: str
    value: Any = None
    updated_at: datetime | None = None
