from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.constants_metal import PRODUCTION_STATUSES


def _status_ok(v: str) -> str:
    if v not in PRODUCTION_STATUSES:
        raise ValueError(f"无效状态，可选：{', '.join(PRODUCTION_STATUSES)}")
    return v


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    contact_name: str | None = None
    phone: str | None = None
    address: str | None = None
    remark: str | None = None


class CustomerUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    contact_name: str | None = None
    phone: str | None = None
    address: str | None = None
    remark: str | None = None


class CustomerOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    contact_name: str | None = None
    phone: str | None = None
    address: str | None = None
    remark: str | None = None
    created_at: datetime | None = None


class OrderItemCreate(BaseModel):
    incoming_no: str | None = None
    material_grade: str | None = None
    production_no: str | None = None
    spec_incoming: str | None = None
    weight_incoming: Decimal | None = None
    quantity: int = Field(default=1, ge=1)
    weight_return: Decimal | None = None
    formed_size: str | None = None
    forging_requirements: str | None = None
    production_process: str | None = None
    remark: str | None = None
    production_status: str = "未入库"
    return_date: date | None = None
    incoming_date: date | None = None
    cutting_time: datetime | None = None

    @field_validator("production_status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        return _status_ok(v)


class OrderItemUpdate(BaseModel):
    incoming_no: str | None = None
    material_grade: str | None = None
    production_no: str | None = None
    spec_incoming: str | None = None
    weight_incoming: Decimal | None = None
    quantity: int | None = Field(None, ge=1)
    weight_return: Decimal | None = None
    formed_size: str | None = None
    forging_requirements: str | None = None
    production_process: str | None = None
    remark: str | None = None
    production_status: str | None = None
    return_date: date | None = None
    incoming_date: date | None = None
    cutting_time: datetime | None = None

    @field_validator("production_status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _status_ok(v)


class OrderItemOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    order_id: int
    sort_order: int
    incoming_no: str | None = None
    material_grade: str | None = None
    production_no: str | None = None
    spec_incoming: str | None = None
    weight_incoming: Decimal | None = None
    quantity: int
    weight_return: Decimal | None = None
    formed_size: str | None = None
    forging_requirements: str | None = None
    production_process: str | None = None
    remark: str | None = None
    production_status: str
    return_date: date | None = None
    incoming_date: date | None = None
    cutting_time: datetime | None = None


class GrindLogCreate(BaseModel):
    note: str | None = None


class GrindLogOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    order_item_id: int
    note: str | None = None
    created_at: datetime | None = None


class OrderGrindLogRow(BaseModel):
    """订单下所有来料明细的修磨等记录（按时间倒序）"""

    id: int
    order_item_id: int
    production_no: str | None = None
    incoming_no: str | None = None
    note: str | None = None
    created_at: datetime | None = None


class OrderCreate(BaseModel):
    """订单编号由服务端自动生成，无需传 order_no。"""

    customer_id: int
    remark: str | None = None
    items: list[OrderItemCreate] = Field(default_factory=list)


class OrderUpdate(BaseModel):
    customer_id: int | None = None
    remark: str | None = None


class OrderListOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    order_no: str
    customer_id: int
    remark: str | None = None
    created_at: datetime | None = None


class OrderListRow(BaseModel):
    id: int
    order_no: str
    customer_id: int
    customer_name: str
    remark: str | None = None
    created_at: datetime | None = None
    order_status: str = Field(
        description="聚合状态：已下单 / 待入库 / 待完成 n/m / 已完成",
    )
    item_count: int = 0
    item_done_count: int = 0


class OrderDetailOut(OrderListOut):
    customer: CustomerOut
    items: list[OrderItemOut] = Field(default_factory=list)


class TaskItemOut(OrderItemOut):
    """任务视图：来料任务行 + 订单信息"""

    order_no: str
    customer_name: str
    order_remark: str | None = None


class DashboardSummary(BaseModel):
    customer_count: int
    order_count: int
    item_count: int
    status_counts: dict[str, int]


class ReorderItemsBody(BaseModel):
    item_ids: list[int]
