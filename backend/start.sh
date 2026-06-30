#!/bin/bash

echo "==================================="
echo "  正在停止旧服务（后端+前端）"
echo "==================================="

# 杀死后端 8000 端口
lsof -i :8000 | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null

# 杀死所有 npm run dev 进程
pkill -f "npm run dev" 2>/dev/null

sleep 1

echo "==================================="
echo "  启动后端 FastAPI 服务"
echo "==================================="
cd /var/www/huijin/backend
nohup bash -c "source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000" > app.log 2>&1 &

sleep 2

echo "==================================="
echo "  启动前端 npm run dev"
echo "==================================="
cd /var/www/huijin/front
nohup npm run dev > dev.log 2>&1 &

echo ""
echo "✅ 启动完成！"
echo "📄 后端日志：tail -f /var/www/huijin/backend/app.log"
echo "📄 前端日志：tail -f /var/www/huijin/front/dev.log"