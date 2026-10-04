# scripts

Script hỗ trợ phát triển, thêm dần theo từng task.

- `docker/dev-start.sh`: lệnh khởi động container dev của backend/admin (TASK-002).
- `docker/placeholder-server.js`: server giữ chỗ khi ứng dụng chưa được khởi tạo (TASK-002).
- `setup-env.sh`: tạo `.env` local từ `.env.development`, sinh `JWT_SECRET` ngẫu nhiên (TASK-003).
- `check-env.sh`: kiểm tra `.env` đủ biến bắt buộc và không bị commit (TASK-003).
- `check-commit-msg.sh`: kiểm tra commit message, dùng bởi hook `.githooks/commit-msg` (TASK-005).
- `check-branch-name.sh`: kiểm tra tên branch, dùng bởi hook `.githooks/pre-push` (TASK-005).
