"""项目路径：统一上传目录。

历史数据与原先 nginx 均使用 backend/app/uploads/，此处保持一致，避免 404。
"""

from pathlib import Path

# backend/
BACKEND_ROOT = Path(__file__).resolve().parent.parent
# backend/app/uploads/（与线上已有图片、原 nginx alias 一致）
UPLOAD_ROOT = Path(__file__).resolve().parent / "uploads"
