#!/bin/sh
# Lệnh khởi động container dev cho backend/admin.
# - Nếu ứng dụng đã được khởi tạo (có package.json): cài dependency nếu thiếu rồi chạy script dev.
# - Nếu chưa (trước TASK-028 / TASK-100): chạy server giữ chỗ để container vẫn hoạt động.
set -e

if [ -f package.json ]; then
  if [ ! -d node_modules/.bin ]; then
    npm install
  fi
  exec npm run "${DEV_SCRIPT:-dev}"
fi

echo "[$SERVICE_NAME] Chưa có package.json, chạy server giữ chỗ trên cổng $PORT"
exec node /opt/dev/placeholder-server.js
