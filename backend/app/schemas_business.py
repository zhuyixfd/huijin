from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.constants_metal import PRODUCTION_STATUSES


def _status_ok(v: str) -> str:
    if v not in PRODUCTION_STATUSES:
        raise ValueError(f"无效状态，可选：{', '.join(PRODUCTION_STATUSES)}")
    return v


def _normalize_customer_abbr(v: str) -> str:
    s = "".join(c for c in v.strip() if c.isalnum())
    if not s:
        raise ValueError("客户缩写须为字母或数字，且不能为空")
    return s.upper()


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    abbr: str = Field(min_length=1, max_length=32, description="订单号用，全库唯一，建议大写字母与数字")
    contact_name: str | None = None
    phone: str | None = None
    address: str | None = None
    remark: str | None = None

    @field_validator("abbr")
    @classmethod
    def validate_abbr(cls, v: str) -> str:
        return _normalize_customer_abbr(v)


class CustomerUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    abbr: str | None = Field(None, min_length=1, max_length=32)
    contact_name: str | None = None
    phone: str | None = None
    address: str | None = None
    remark: str | None = None

    @field_validator("abbr")
    @classmethod
    def validate_abbr(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _normalize_customer_abbr(v)


class CustomerOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    abbr: str
    contact_name: str | None = None
    phone: str | None = None
    address: str | None = None
    remark: str | None = None
    created_at: datetime | None = None


class FinishedOutputIn(BaseModel):
    """成品明细（同一来料下的一个成品）；件号由排产/处理中自动生成，不可手填。"""

    spec: str | None = Field(None, description="成品规格")
    formed_size: str | None = Field(None, description="成品成型尺寸（可与工序尺寸不同）")
    weight_return: Decimal | None = Field(None, description="该成品发回重量")
    remark: str | None = None


class FinishedOutputOut(FinishedOutputIn):
    model_config = {"from_attributes": True}

    id: int
    sort_order: int = 0
    piece_code: str | None = Field(
        None,
        description="件号（只读，与 processing_unit_codes 按序号对应，排产后生成）",
    )


class OrderItemCreate(BaseModel):
    incoming_no: str | None = None
    material_grade: str | None = None
    spec_incoming: str | None = None
    weight_incoming: Decimal | None = None
    quantity: int = Field(default=1, ge=1)
    weight_return: Decimal | None = None
    cut_head_weight: Decimal | None = None
    formed_size: str | None = None
    forging_requirements: str | None = None
    remark: str | None = None
    remark_images: list[str] | None = None
    production_status: str = "在库中"
    return_date: date | None = None
    incoming_date: date | None = None
    cutting_time: datetime | None = None
    finished_outputs: list[FinishedOutputIn] | None = Field(
        default=None,
        description="成品明细；不传则保存时用主行字段生成一条",
    )

    @field_validator("production_status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        return _status_ok(v)


class OrderItemBatchProductionStatus(BaseModel):
    """批量将多条来料明细设为同一生产状态。"""

    item_ids: list[int] = Field(min_length=1, max_length=500)
    production_status: str
    in_today_queue: bool | None = None
    in_tomorrow_queue: bool | None = None

    @field_validator("production_status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        return _status_ok(v)


class OrderItemUpdate(BaseModel):
    incoming_no: str | None = None
    material_grade: str | None = None
    spec_incoming: str | None = None
    weight_incoming: Decimal | None = None
    quantity: int | None = Field(None, ge=1)
    weight_return: Decimal | None = None
    cut_head_weight: Decimal | None = None
    formed_size: str | None = None
    forging_requirements: str | None = None
    remark: str | None = None
    remark_images: list[str] | None = None
    production_status: str | None = None
    in_today_queue: bool | None = None
    in_tomorrow_queue: bool | None = None
    return_date: date | None = None
    incoming_date: date | None = None
    cutting_time: datetime | None = None
    finished_outputs: list[FinishedOutputIn] | None = None

    @field_validator("production_status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _status_ok(v)


class OrderItemOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    order_no: str
    customer_id: int
    created_at: datetime | None = None
    order_remark: str | None = None
    sort_order: int = 0
    incoming_no: str | None = None
    material_grade: str | None = None
    spec_incoming: str | None = None
    weight_incoming: Decimal | None = None
    quantity: int
    weight_return: Decimal | None = None
    cut_head_weight: Decimal | None = None
    formed_size: str | None = None
    forging_requirements: str | None = None
    remark: str | None = None
    remark_images: list[str] | None = None
    production_status: str
    in_today_queue: bool = False
    in_tomorrow_queue: bool = False
    return_date: date | None = None
    incoming_date: date | None = None
    cutting_time: datetime | None = None
    processing_unit_codes: list[str] | None = Field(
        default=None,
        description="处理中单件编号（与个数等长），生成后永久保留",
    )
    split_group_id: str | None = None
    split_base_order_no: str | None = None
    split_seq: int | None = None
    finished_outputs: list[FinishedOutputOut] = Field(default_factory=list)


class GrindLogCreate(BaseModel):
    note: str | None = None
    unit_index: int | None = Field(
        default=None,
        description="对应展开后的第几件（0 起）；不传表示整条明细共用（旧数据）",
    )


class GrindLogOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    order_item_id: int
    note: str | None = None
    unit_index: int | None = None
    created_at: datetime | None = None


class OrderGrindLogRow(BaseModel):
    """订单下所有来料明细的修磨等记录（按时间倒序）"""

    id: int
    order_item_id: int
    order_no: str | None = None
    incoming_no: str | None = None
    note: str | None = None
    unit_index: int | None = None
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


class WorkOrderCreate(OrderItemCreate):
    """一单一条来料：创建订单 + 唯一明细。"""

    customer_id: int
    order_remark: str | None = Field(None, description="订单备注（抬头）")


class TaskItemOut(OrderItemOut):
    """来料订单列表行（表连接补充客户名、展示用状态）。"""

    customer_name: str
    order_created_at: datetime | None = None
    order_status: str = Field(
        default="",
        description="与订单列表一致的聚合状态（一单一条来料时等同该行状态）",
    )
    case_study_count: int = Field(
        default=0,
        description="关联的生产案例条数（用于列表徽标）",
    )
    case_study_by_unit: dict[str, int] = Field(
        default_factory=dict,
        description="按支点（件序号 0 起）的案例条数；键为字符串形式的 unit_index",
    )


class TaskItemListOut(BaseModel):
    """分页列表：items + 筛选条件下的总数 total。"""

    items: list[TaskItemOut]
    total: int


class CutHeadLogCreate(BaseModel):
    order_item_id: int
    weight: Decimal = Field(gt=0)


class CutHeadLogRow(BaseModel):
    id: int
    order_item_id: int
    order_no: str
    customer_name: str
    incoming_no: str | None = None
    material_grade: str | None = None
    weight: Decimal
    created_at: datetime


class CutHeadLogListOut(BaseModel):
    items: list[CutHeadLogRow]
    total: int


class SplitOrderBody(BaseModel):
    order_item_id: int
    move_unit_indexes: list[int] = Field(min_length=1, max_length=500)


class SplitOrderOut(BaseModel):
    base_order_no: str
    order_no_1: str
    order_no_2: str
    item_id_1: int
    item_id_2: int


class SplitMergeLogRow(BaseModel):
    id: int
    action: str
    base_order_no: str
    order_no_a: str
    order_no_b: str | None = None
    production_status: str
    operator_username: str | None = None
    created_at: datetime


class SplitMergeLogListOut(BaseModel):
    items: list[SplitMergeLogRow]
    total: int


class ProcessingLetterPieceCount(BaseModel):
    """侧栏件号轮回字母对应的在制件数"""

    letter: str = Field(..., min_length=1, max_length=1)
    count: int = Field(ge=0)


class TaskNavCountsOut(BaseModel):
    """侧栏订单分组数量（不受列表搜索条件影响）。"""

    all: int
    pending: int
    processing: int
    cut_head: int = Field(default=0, description="切头记录条数")
    ready_outbound: int
    done: int
    processing_piece_strip: list[ProcessingLetterPieceCount] = Field(
        default_factory=list,
        description="处理中（不含待发回）按件号首字母统计，顺序与轮回表一致",
    )


class DashboardSummary(BaseModel):
    customer_count: int
    order_count: int
    item_count: int
    status_counts: dict[str, int]
    case_study_count: int = Field(default=0, description="案例总数")


class CaseStudyRow(BaseModel):
    """首页案例列表 / 新建响应"""

    model_config = {"from_attributes": True}

    id: int
    order_item_id: int
    order_no: str
    customer_name: str
    unit_index: int | None = None
    note: str | None = None
    images: list[str] = Field(default_factory=list, description="可访问的相对路径，如 /uploads/cases/xxx.png")
    created_at: datetime


class CaseStudyListOut(BaseModel):
    items: list[CaseStudyRow]
    total: int


class ReorderItemsBody(BaseModel):
    item_ids: list[int]
