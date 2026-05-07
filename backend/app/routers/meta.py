from fastapi import APIRouter, Depends

from app.constants_metal import PRODUCTION_STATUSES
from app.deps import get_current_user
from app.models import User as UserModel

router = APIRouter()


@router.get("/production-statuses")
def production_statuses(_: UserModel = Depends(get_current_user)):
    return {"statuses": list(PRODUCTION_STATUSES)}


@router.get("/order-status-filters")
def order_status_filters(_: UserModel = Depends(get_current_user)):
    """订单列表聚合状态筛选项（与订单管理列表展示一致）。"""
    return {
        "filters": [
            {"value": "all", "label": "全部"},
            {"value": "placed", "label": "已下单"},
            {"value": "waiting_inbound", "label": "待入库"},
            {"value": "in_progress", "label": "待完成"},
            {"value": "completed", "label": "已完成"},
        ]
    }
