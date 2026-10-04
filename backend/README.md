# backend

Backend API viết bằng NestJS 12 (TypeScript, ESM), kết nối PostgreSQL + PostGIS. Kiến trúc: modular monolith, mỗi nghiệp vụ một module NestJS.

## Cấu trúc

```text
backend/
├── src/
│   ├── main.ts            # điểm khởi động: đọc cấu hình, lắng nghe cổng
│   ├── app.factory.ts     # tạo app dùng chung cho main.ts và test (tiền tố /api/v1)
│   ├── app.module.ts      # module gốc; module nghiệp vụ thêm ở các task sau
│   ├── config/            # đọc và kiểm tra biến môi trường (AppConfigModule, token APP_CONFIG)
│   └── database/          # kết nối TypeORM, TenantEntity, TenantRepository, SnakeNamingStrategy
├── test/                  # test (node:test), chạy trên bản build trong .test-dist/
│   └── support/           # database test riêng <db>_backend_test, chạy migration của database/
├── nest-cli.json
├── tsconfig.json          # extends ../tsconfig.base.json, bật decorator
└── tsconfig.build.json    # build production từ src/ ra dist/
```

## Lệnh

Chạy trong thư mục `backend/` sau `npm install`.

| Lệnh                | Tác dụng                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run start:dev` | Chạy dev, tự build lại khi sửa code                                                                       |
| `npm run build`     | Build ra `dist/`                                                                                          |
| `npm start`         | Chạy bản build (`node dist/main.js`)                                                                      |
| `npm test`          | Build vào `.test-dist/` rồi chạy `node:test` trên database `<db>_backend_test` (cần PostgreSQL đang chạy) |

Lint, format, typecheck chạy chung ở thư mục gốc: `npm run check`.

Trong Docker (`docker compose up backend`), container tự `npm install` lần đầu rồi chạy `npm run start:dev`.

## Biến môi trường

| Biến           | Mặc định      | Kiểm tra                                       |
| -------------- | ------------- | ---------------------------------------------- |
| `PORT`         | `3000`        | Số nguyên 1–65535                              |
| `NODE_ENV`     | `development` | `development` \| `production` \| `test`        |
| `DATABASE_URL` | (bắt buộc)    | Dạng `postgresql://USER:PASSWORD@HOST:PORT/DB` |

Sai giá trị thì ứng dụng dừng ngay khi khởi động. Các biến khác (JWT_SECRET…) được dùng từ các task sau.

`npm run start:dev` và `npm test` tự đọc `../.env.development` rồi `../.env` (biến đã có trong môi trường được giữ nguyên). `npm start` (production) chỉ dùng biến môi trường.

## Database

- Kết nối bằng TypeORM (`src/database/database.module.ts`). Không dùng `synchronize`, không tự chạy migration: schema chỉ thay đổi qua migration trong `database/` (`cd database && npm run migration:run`).
- Không kết nối được thì thử lại 5 lần, mỗi lần cách 3 giây, rồi dừng ứng dụng.
- Kết nối đóng gọn khi ứng dụng tắt (SIGTERM).

### Entity và repository (TASK-030)

- Thuộc tính entity viết camelCase, cột viết snake_case: `SnakeNamingStrategy` tự đổi (`tenantId` → `tenant_id`).
- Entity của bảng nghiệp vụ kế thừa `TenantEntity` (id, tenantId, createdAt, updatedAt, deletedAt). id và các mốc thời gian do database sinh. Entity cụ thể được tạo cùng module nghiệp vụ ở các task sau.
- Chỉ truy vấn bảng nghiệp vụ qua `TenantRepository`:
  - mọi hàm nhận `tenantId` đầu tiên và tự thêm `tenant_id = :tenantId`; thiếu hoặc sai tenantId → `MissingTenantError`;
  - `create` gắn tenant từ tham số; `create`/`update` bỏ qua `id`, `tenantId` và các mốc thời gian dù caller có gửi;
  - đọc, sửa, xoá bản ghi của tenant khác trả về `null`/`false` như không tồn tại;
  - `softDelete` chỉ đặt `deleted_at`; bản ghi đã xoá không còn đọc được;
  - `createQueryBuilder(tenantId, alias, build)` cho truy vấn phức tạp: điều kiện tenant gắn sau cùng, điều kiện của caller được gom trong ngoặc;
  - `withManager(manager)` để chạy trong transaction.
- `tenantId` lấy từ token đăng nhập (TASK-047), không bao giờ lấy từ body/query.

Mọi API nằm dưới tiền tố `/api/v1` (phase0/05-API-CONVENTIONS.md).
