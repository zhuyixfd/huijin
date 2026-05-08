from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
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
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
    order_remark: Mapped[str | None] = mapped_column(Text(), nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")

    incoming_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    material_grade: Mapped[str | None] = mapped_column(String(128), nullable=True)
    production_no: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    spec_incoming: Mapped[str | None] = mapped_column(String(256), nullable=True)
    weight_incoming: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, server_default="1")
    weight_return: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)
    formed_size: Mapped[str | None] = mapped_column(String(256), nullable=True)
    forging_requirements: Mapped[str | None] = mapped_column(Text(), nullable=True)
    production_process: Mapped[str | None] = mapped_column(Text(), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text(), nullable=True)
    production_status: Mapped[str] = mapped_column(
        String(32), server_default="未入库", index=True
    )
    in_today_queue: Mapped[bool] = mapped_column(
        Boolean(), server_default="0", default=False
    )
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    incoming_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    cutting_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="order_items")
    grind_logs: Mapped[list["GrindLog"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="GrindLog.created_at",
    )


class GrindLog(Base):
    """修磨等多道记录"""

    __tablename__ = "grind_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), index=True
    )
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    item: Mapped["OrderItem"] = relationship(back_populates="grind_logs")
