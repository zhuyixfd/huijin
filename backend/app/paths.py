"""项目路径：统一 backend 根目录与上传目录。"""

from pathlib import Path

# backend/（含 app/、uploads/、.venv/）
BACKEND_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_ROOT = BACKEND_ROOT / "uploads"
