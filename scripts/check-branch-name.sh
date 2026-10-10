#!/bin/sh
# Kiểm tra tên branch theo quy tắc dự án.
# Dùng: sh scripts/check-branch-name.sh [tên branch, mặc định branch hiện tại]

BRANCH=${1:-$(git rev-parse --abbrev-ref HEAD)}

case "$BRANCH" in
  main | develop) exit 0 ;;
esac

if printf '%s\n' "$BRANCH" | grep -Eq '^(feature|fix)/[a-z0-9]+(-[a-z0-9]+)*$'; then
  exit 0
fi

echo "✖ Tên branch không hợp lệ: $BRANCH"
echo "  Cho phép: main, develop, feature/<mô-tả-kebab>, fix/<mô-tả-kebab>"
echo "  Ví dụ: feature/task-049-create-property, fix/task-052-update-validation"
exit 1
