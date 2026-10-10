# Đóng góp

1. Đọc [README.md](README.md) và chạy `npm install` ở thư mục gốc (bật git hooks, cài công cụ chuẩn code).
2. Làm việc theo [docs/git-workflow.md](docs/git-workflow.md): mỗi task một branch `feature/*` hoặc `fix/*` tạo từ `develop`, merge qua Pull Request.
3. Tuân thủ [docs/coding-standards.md](docs/coding-standards.md); chạy `npm run check` trước khi commit.
4. Biến môi trường và secret: [docs/environment.md](docs/environment.md). Không commit `.env`.
5. Mỗi task đi theo: READ → PLAN → IMPLEMENT → TEST → REVIEW → FIX → DOCUMENT → COMMIT, và chỉ làm đúng phạm vi task.
