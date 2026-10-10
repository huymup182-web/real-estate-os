# database

Migration PostgreSQL + PostGIS của AI Real Estate OS, dùng TypeORM. Thiết kế đầy đủ: [docs/database.md](../docs/database.md), sơ đồ [docs/erd.png](../docs/erd.png).

Backend NestJS (TASK-028+) sẽ dùng lại chính các migration trong thư mục này, nên cả dự án chỉ có một bộ migration.

## Cấu trúc

```text
database/
├── src/
│   ├── data-source.ts   # DataSource TypeORM (đọc DATABASE_URL, không dùng synchronize)
│   ├── cli.ts           # lệnh run / revert / show / seed / create
│   └── seed.ts          # dữ liệu demo (TASK-027)
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
| `npm run seed`                             | Nạp dữ liệu demo (xem mục Dữ liệu demo)                        |
| `npm test`                                 | Test migration trên database `<tên>_test` (tự tạo nếu chưa có) |

Test xoá sạch schema của database test, nên chỉ chạy trên database có tên kết thúc bằng `_test`. Đặt `TEST_DATABASE_URL` nếu muốn dùng database test khác.

## Dữ liệu demo

`npm run seed` (sau `migration:run`) tạo công ty `demo` gồm:

- 6 role mặc định với ma trận quyền theo `phase0/04-RBAC.md` mục 4.
- 5 tài khoản: `admin`, `manager`, `agent1`, `agent2`, `agent3`, email `<tên>@demo.realestate-os.test`. Admin có role COMPANY_ADMIN, manager có role MANAGER (trưởng phòng Kinh doanh, leader Team Nha Trang), 3 agent có role AGENT.
- Tỉnh Khánh Hòa và 4 phường demo ở Nha Trang (mã có tiền tố `DM-`, không phải mã hành chính chính thức).
- 5 chủ nhà, 20 BĐS có toạ độ, 10 khách có nhu cầu.

Mật khẩu chung của các tài khoản demo lấy từ biến `SEED_DEMO_PASSWORD` (≥ 8 ký tự, đặt trong `../.env`), lưu dạng argon2id. Lệnh không chạy khi `NODE_ENV=production` và không làm gì nếu công ty `demo` đã có.

## Quy tắc

- Mỗi thay đổi schema là một migration mới; không sửa migration đã merge.
- Viết SQL rõ ràng trong `up()`, và `down()` phải hoàn tác đầy đủ.
- Đặt tên constraint/index theo `docs/coding-standards.md` (`pk_`, `fk_`, `uq_`, `ck_`, `idx_`, `trg_`).
- Mỗi migration có test: cấu trúc bảng, ràng buộc, revert.

## Migration hiện có

| Migration                                       | Task     | Nội dung                                                          |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `1791093463414-create-updated-at-function`      | TASK-007 | Hàm trigger `set_updated_at()` dùng chung cho mọi bảng            |
| `1791093463415-create-companies`                | TASK-007 | Bảng `companies`                                                  |
| `1791094180612-enable-citext`                   | TASK-008 | Extension `citext` (email không phân biệt hoa thường)             |
| `1791094180613-create-users`                    | TASK-008 | Bảng `users` (`department_id` thêm ở TASK-011)                    |
| `1791094605215-create-roles`                    | TASK-009 | Bảng `roles` và `user_roles` (trigger chặn gán role chéo công ty) |
| `1791095078398-create-permissions`              | TASK-010 | Bảng `permissions` (kèm danh mục quyền MVP) và `role_permissions` |
| `1791095262098-create-departments`              | TASK-011 | Bảng `departments` và cột `users.department_id`                   |
| `1791095454364-create-teams`                    | TASK-012 | Bảng `teams` và `team_members`                                    |
| `1791095795199-create-locations`                | TASK-013 | Bảng `provinces`, `districts`, `wards` (chưa có dữ liệu)          |
| `1791096043111-enable-postgis-unaccent`         | TASK-014 | Extension `postgis`, `unaccent` và hàm `immutable_unaccent()`     |
| `1791096044509-create-properties`               | TASK-014 | Bảng `properties` (`owner_id` thêm ở TASK-017)                    |
| `1791096412946-create-property-images`          | TASK-015 | Bảng `property_images`                                            |
| `1791096871613-create-property-documents`       | TASK-016 | Bảng `property_documents`                                         |
| `1791097085181-create-owners`                   | TASK-017 | Bảng `owners` và cột `properties.owner_id`                        |
| `1791097408096-create-customers`                | TASK-018 | Bảng `customers` và `customer_preferences`                        |
| `1791097819681-create-customer-activities`      | TASK-019 | Bảng `customer_activities` (chỉ thêm, không sửa)                  |
| `1791098216229-create-property-favorites-views` | TASK-020 | Bảng `property_favorites` và `property_views` (lượt xem chỉ thêm) |
| `1791099052685-create-saved-searches`           | TASK-021 | Bảng `saved_searches`                                             |
| `1791099160108-create-appointments`             | TASK-022 | Bảng `appointments`                                               |
| `1791099481730-create-deals-commissions`        | TASK-023 | Bảng `deals`, `commissions`                                       |
| `1791099821233-create-notifications`            | TASK-024 | Bảng `notifications`                                              |
| `1791100233724-create-audit-logs`               | TASK-025 | Bảng `audit_logs`                                                 |
| `1791100552216-add-query-indexes`               | TASK-026 | Index truy vấn chính                                              |
