#!/bin/sh
# Tạo file .env cho máy local từ .env.development.
# - Không ghi đè .env đã có.
# - Sinh JWT_SECRET ngẫu nhiên thay cho giá trị dev mặc định.
# Dùng: sh scripts/setup-env.sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env"
SOURCE_FILE="$ROOT_DIR/.env.development"

if [ -f "$ENV_FILE" ]; then
  echo ".env đã tồn tại, giữ nguyên. Xoá file nếu muốn tạo lại."
  exit 0
fi

if command -v openssl >/dev/null 2>&1; then
  SECRET=$(openssl rand -hex 32)
else
  SECRET=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
fi

sed "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" "$SOURCE_FILE" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Đã tạo .env với JWT_SECRET ngẫu nhiên. Điền thêm STORAGE_KEY, AI_API_KEY, FCM_CONFIG khi cần."
