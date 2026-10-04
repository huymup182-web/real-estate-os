# database

Migration PostgreSQL + PostGIS của AI Real Estate OS, dùng TypeORM. Thiết kế đầy đủ: [docs/database.md](../docs/database.md), sơ đồ [docs/erd.png](../docs/erd.png).

Backend NestJS (TASK-028+) sẽ dùng lại chính các migration trong thư mục này, nên cả dự án chỉ có một bộ migration.

## Cấu trúc

```text
database/
├── src/
│   ├── data-source.ts   # DataSource TypeORM (đọc DATABASE_URL, không dùng synchronize)
│   └── cli.ts           # lệnh run / revert / show / create
├── migrations/          # mỗi file một migration, tên <timestamp>-<mô-tả-kebab>.ts
└── test/                # test migration (node:test), chạy trên database *_test
```

Code TypeScript chạy trực tiếp bằng Node.js ≥ 22.18 (type stripping), không cần build.

## Lệnh

Chạy trong thư mục `database/` sau `npm install`. Cần PostgreSQL đang chạy (`docker compose up -d postgres` ở thư mục gốc). `DATABASE_URL` lấy từ biến môi trường, hoặc từ `../.env.development` rồi `../.env`.

| Lệnh                                       | Tác dụng                                                       |
| ------------------------------------------ | -------------------------------------------------------------- |
| `npm run migration:run`                    | Chạy các migration chưa chạy                                   |
| `npm run migration:revert`                 | Hoàn tác migration gần nhất                                    |
| `npm run migration:show`                   | Kiểm tra còn migration chưa chạy không                         |
| `npm run migration:create -- create-users` | Tạo file migration mới                                         |
| `npm test`                                 | Test migration trên database `<tên>_test` (tự tạo nếu chưa có) |

Test xoá sạch schema của database test, nên chỉ chạy trên database có tên kết thúc bằng `_test`. Đặt `TEST_DATABASE_URL` nếu muốn dùng database test khác.

## Quy tắc

- Mỗi thay đổi schema là một migration mới; không sửa migration đã merge.
- Viết SQL rõ ràng trong `up()`, và `down()` phải hoàn tác đầy đủ.
- Đặt tên constraint/index theo `docs/coding-standards.md` (`pk_`, `fk_`, `uq_`, `ck_`, `idx_`, `trg_`).
- Mỗi migration có test: cấu trúc bảng, ràng buộc, revert.

## Migration hiện có

| Migration                                  | Task     | Nội dung                                                |
| ------------------------------------------ | -------- | ------------------------------------------------------- |
| `1791093463414-create-updated-at-function` | TASK-007 | Hàm trigger `set_updated_at()` dùng chung cho mọi bảng  |
| `1791093463415-create-companies`           | TASK-007 | Bảng `companies`                                        |
| `1791094180612-enable-citext`              | TASK-008 | Extension `citext` (email không phân biệt hoa thường)   |
| `1791094180613-create-users`               | TASK-008 | Bảng `users` (chưa có `department_id`, thêm ở TASK-011) |
