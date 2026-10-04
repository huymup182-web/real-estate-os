#!/bin/sh
# Kiểm tra commit message theo quy tắc Conventional Commits của dự án.
# Dùng: sh scripts/check-commit-msg.sh <file chứa commit message>
# Được gọi tự động bởi .githooks/commit-msg. Chi tiết: docs/git-workflow.md

MSG_FILE="$1"
if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
  echo "Dùng: sh scripts/check-commit-msg.sh <file commit message>"
  exit 2
fi

# Dòng đầu tiên không phải comment
SUBJECT=$(grep -v '^#' "$MSG_FILE" | head -n 1)

# Commit do git tự sinh (merge, revert, fixup/squash) được bỏ qua
case "$SUBJECT" in
  "Merge "* | "Revert "* | "fixup! "* | "squash! "* | "amend! "*) exit 0 ;;
esac

TYPES="feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"
PATTERN="^($TYPES)(\([a-z0-9-]+\))?!?: [^ ].*$"

if ! printf '%s\n' "$SUBJECT" | grep -Eq "$PATTERN"; then
  echo "✖ Commit message không đúng quy tắc:"
  echo "    $SUBJECT"
  echo ""
  echo "  Định dạng: <type>(<scope>): <mô tả> (TASK-xxx)"
  echo "  type:  $(echo "$TYPES" | tr '|' ' ')"
  echo "  scope: tuỳ chọn, chữ thường, vd backend, admin, mobile, database, docker"
  echo "  Ví dụ: feat(backend): add property create API (TASK-049)"
  exit 1
fi

LENGTH=$(printf '%s' "$SUBJECT" | wc -m | tr -d ' ')
if [ "$LENGTH" -gt 100 ]; then
  echo "✖ Dòng đầu commit dài $LENGTH ký tự, tối đa 100."
  exit 1
fi

exit 0
