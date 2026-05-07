from fastapi import APIRouter, Depends

from app.constants_metal import PRODUCTION_STATUSES
from app.deps import get_current_user
from app.models import User as UserModel

router = APIRouter()


@router.get("/production-statuses")
def production_statuses(_: UserModel = Depends(get_current_user)):
    return {"statuses": list(PRODUCTION_STATUSES)}
