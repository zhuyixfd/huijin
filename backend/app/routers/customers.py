from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Customer, OrderItem
from app.models import User as UserModel
from app.schemas_business import CustomerCreate, CustomerOut, CustomerUpdate

router = APIRouter()


@router.get("", response_model=list[CustomerOut])
def list_customers(
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="按名称模糊搜索"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    stmt = select(Customer).order_by(Customer.id.desc())
    if q:
        stmt = stmt.where(Customer.name.contains(q.strip()))
    stmt = stmt.offset(skip).limit(limit)
    return list(db.scalars(stmt).all())


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
def create_customer(
    body: CustomerCreate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = Customer(
        name=body.name.strip(),
        contact_name=body.contact_name,
        phone=body.phone,
        address=body.address,
        remark=body.remark,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    return row


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: int,
    _: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    cnt = db.scalar(
        select(func.count()).select_from(OrderItem).where(OrderItem.customer_id == customer_id)
    )
    if cnt and cnt > 0:
        raise HTTPException(status_code=400, detail="该客户下已有订单，无法删除")
    db.delete(row)
    db.commit()
    return None
