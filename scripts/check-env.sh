#!/bin/sh
# Kiểm tra file môi trường có đủ các biến bắt buộc và không có secret bị commit.
# Dùng: sh scripts/check-env.sh [đường dẫn file env, mặc định .env]
# Thoát mã 1 nếu có lỗi.
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${1:-"$ROOT_DIR/.env"}
REQUIRED="DATABASE_URL JWT_SECRET STORAGE_KEY AI_API_KEY FCM_CONFIG"
ERRORS=0

if [ ! -f "$ENV_FILE" ]; then
  echo "Không tìm thấy $ENV_FILE. Chạy: sh scripts/setup-env.sh"
  exit 1
fi

for KEY in $REQUIRED; do
  if ! grep -q "^$KEY=" "$ENV_FILE"; then
    echo "Thiếu biến: $KEY"
    ERRORS=$((ERRORS + 1))
  fi
done

for KEY in DATABASE_URL JWT_SECRET; do
  VALUE=$(grep "^$KEY=" "$ENV_FILE" | head -n 1 | cut -d= -f2-)
  if [ -z "$VALUE" ]; then
    echo "Biến $KEY đang để trống"
    ERRORS=$((ERRORS + 1))
  fi
done

if git -C "$ROOT_DIR" ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "Lỗi: .env đang bị git theo dõi, phải xoá khỏi git"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "check-env: $ERRORS lỗi"
  exit 1
fi
echo "check-env: OK ($ENV_FILE)"
