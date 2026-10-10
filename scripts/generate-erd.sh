#!/bin/sh
# Tạo docs/erd.png từ docs/erd.dot bằng Graphviz.
# Dùng Graphviz cài trên máy nếu có (lệnh `dot`), không thì chạy Graphviz trong Docker.
# Dùng: sh scripts/generate-erd.sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
DOCS_DIR="$ROOT_DIR/docs"

if command -v dot >/dev/null 2>&1; then
  dot -Tpng -Gdpi=96 "$DOCS_DIR/erd.dot" -o "$DOCS_DIR/erd.png"
else
  docker run --rm -v "$DOCS_DIR:/work" -w /work alpine:3.20 sh -c \
    "apk add --no-cache graphviz font-dejavu >/dev/null && dot -Tpng -Gdpi=96 erd.dot -o erd.png"
fi

echo "Đã tạo docs/erd.png"
