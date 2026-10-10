#!/bin/sh
# Triển khai một bản lên máy chủ (TASK-160, docs/deployment.md). Chạy trong thư mục deploy/ trên VPS:
#   ./deploy.sh <IMAGE_TAG>   # commit git đã có image trên GHCR; không truyền thì dùng IMAGE_TAG trong .env
# Thứ tự: kéo image → sao lưu database → migration → khởi động lại → chờ backend khỏe.
# Lỗi ở bước nào thì dừng ở bước đó; bản đang chạy chưa bị thay cho tới bước khởi động lại.
# SKIP_PULL=1: dùng image build tại máy (docker compose build). SKIP_BACKUP=1: bỏ sao lưu (chỉ lần đầu, database trống).
set -eu
cd "$(dirname "$0")"

die() {
  echo "Lỗi: $*" >&2
  exit 1
}

[ -f .env ] || die "thiếu deploy/.env (copy từ env.example)"
[ -f production.env ] || die "thiếu deploy/production.env (copy từ production.env.example)"

previous=$(sed -n 's/^IMAGE_TAG=//p' .env)
tag=${1:-$previous}
[ -n "$tag" ] || die "chưa có IMAGE_TAG: ./deploy.sh <commit>"
case $tag in
  *[!A-Za-z0-9._-]*) die "IMAGE_TAG không hợp lệ: $tag" ;;
esac
if grep -q '^IMAGE_TAG=' .env; then
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" .env
else
  echo "IMAGE_TAG=$tag" >> .env
fi
echo "Triển khai $tag (bản trước: ${previous:-chưa có})"

if [ "${SKIP_PULL:-0}" != 1 ]; then
  docker compose pull backend admin migrate
fi

docker compose up -d --wait postgres

if [ "${SKIP_BACKUP:-0}" != 1 ]; then
  docker compose run --rm backup create
fi

docker compose run --rm migrate run

docker compose up -d --wait --wait-timeout 180 backend admin caddy \
  || {
    docker compose logs --tail 100 backend admin >&2
    die "backend/admin không khỏe. Quay lại bản trước: ./deploy.sh ${previous:-<commit>}"
  }

if [ -f alertmanager/alertmanager.yml ] && [ -f secrets/metrics_token ]; then
  docker compose --profile monitoring up -d prometheus alertmanager node-exporter
fi

docker image prune -f > /dev/null
echo "Đã triển khai $tag"
