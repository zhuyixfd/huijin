from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str] = mapped_column(
        String(32), server_default="employee", default="employee"
    )
    permission_codes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UserUiPreference(Base):
    __tablename__ = "user_ui_preferences"
    __table_args__ = (UniqueConstraint("user_id", "pref_key", name="uq_user_ui_preferences_user_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pref_key: Mapped[str] = mapped_column(String(128), index=True)
    pref_value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    abbr: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    contact_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(String(512), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    order_items: Mapped[list["OrderItem"]] = relationship(back_populates="customer")


class OrderItem(Base):
    """来料订单（一行一单）：订单编号与客户均在同一表"""

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    order_no: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    returned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    order_remark: Mapped[str | None] = mapped_column(Text(), nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")

    incoming_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    material_grade: Mapped[str | None] = mapped_column(String(128), nullable=True)
    spec_incoming: Mapped[str | None] = mapped_column(String(256), nullable=True)
    weight_incoming: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)
    incoming_quantity: Mapped[int] = mapped_column(Integer, server_default="1")
    quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_return: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)
    cut_head_weight: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)
    formed_size: Mapped[str | None] = mapped_column(String(256), nullable=True)
    forging_requirements: Mapped[str | None] = mapped_column(Text(), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text(), nullable=True)
    remark_images: Mapped[list | None] = mapped_column(JSON, nullable=True)
    incoming_sheet_images: Mapped[list | None] = mapped_column(JSON, nullable=True)
    production_status: Mapped[str] = mapped_column(
        String(32), server_default="在库中", index=True
    )
    in_today_queue: Mapped[bool] = mapped_column(
        Boolean(), server_default="0", default=False
    )
    in_tomorrow_queue: Mapped[bool] = mapped_column(
        Boolean(), server_default="0", default=False
    )
    processing_unit_codes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    unit_production_statuses: Mapped[list | None] = mapped_column(JSON, nullable=True)
    split_group_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    split_base_order_no: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    split_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    promised_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    incoming_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    cutting_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="order_items")
    grind_logs: Mapped[list["GrindLog"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="GrindLog.created_at",
    )
    cut_head_logs: Mapped[list["CutHeadLog"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="CutHeadLog.created_at",
    )
    case_studies: Mapped[list["CaseStudy"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
    )
    finished_outputs: Mapped[list["OrderItemFinishedOutput"]] = relationship(
        back_populates="order_item",
        cascade="all, delete-orphan",
        order_by="OrderItemFinishedOutput.sort_order, OrderItemFinishedOutput.id",
    )


class OrderItemFinishedOutput(Base):
    """成品明细：同一来料订单下的多个成品（件号/规格/重量可不同）。"""

    __tablename__ = "order_item_finished_outputs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"),
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")
    piece_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    spec: Mapped[str | None] = mapped_column(String(256), nullable=True)
    formed_size: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pieces: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_return: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text(), nullable=True)

    order_item: Mapped["OrderItem"] = relationship(back_populates="finished_outputs")


class CaseStudy(Base):
    """生产案例（文字 + 图片），可在首页展示"""

    __tablename__ = "case_studies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), index=True
    )
    unit_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    images: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    item: Mapped["OrderItem"] = relationship(back_populates="case_studies")


class GrindLog(Base):
    """修磨等多道记录"""

    __tablename__ = "grind_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), index=True
    )
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    unit_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    item: Mapped["OrderItem"] = relationship(back_populates="grind_logs")


class CutHeadLog(Base):
    __tablename__ = "cut_head_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), index=True
    )
    weight: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    item: Mapped["OrderItem"] = relationship(back_populates="cut_head_logs")


class SplitMergeLog(Base):
    __tablename__ = "split_merge_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    action: Mapped[str] = mapped_column(String(16), index=True)
    group_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    base_order_no: Mapped[str] = mapped_column(String(64), index=True)
    order_no_a: Mapped[str] = mapped_column(String(64), index=True)
    order_no_b: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    production_status: Mapped[str] = mapped_column(String(32), index=True)
    operator_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
