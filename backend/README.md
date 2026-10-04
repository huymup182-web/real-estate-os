# backend

Backend API viết bằng NestJS 12 (TypeScript, ESM), kết nối PostgreSQL + PostGIS. Kiến trúc: modular monolith, mỗi nghiệp vụ một module NestJS.

## Cấu trúc

```text
backend/
├── src/
│   ├── main.ts            # điểm khởi động: đọc cấu hình, lắng nghe cổng
│   ├── app.factory.ts     # tạo app dùng chung cho main.ts và test (tiền tố /api/v1)
│   ├── app.module.ts      # module gốc; module nghiệp vụ thêm ở các task sau
│   ├── auth/              # đăng ký (TASK-036); đăng nhập, token ở các task sau
│   ├── common/            # dùng chung: lỗi, validation, response, logging, request id
│   ├── config/            # đọc và kiểm tra biến môi trường (AppConfigModule, token APP_CONFIG)
│   ├── database/          # kết nối TypeORM, TenantEntity, TenantRepository, SnakeNamingStrategy
│   └── health/            # GET /api/v1/health
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

| Biến           | Mặc định      | Kiểm tra                                                      |
| -------------- | ------------- | ------------------------------------------------------------- |
| `PORT`         | `3000`        | Số nguyên 1–65535                                             |
| `NODE_ENV`     | `development` | `development` \| `production` \| `test`                       |
| `DATABASE_URL` | (bắt buộc)    | Dạng `postgresql://USER:PASSWORD@HOST:PORT/DB`                |
| `LOG_LEVEL`    | `log`         | `fatal` \| `error` \| `warn` \| `log` \| `debug` \| `verbose` |

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

## Xử lý lỗi (TASK-031)

Mọi lỗi trả về cùng một định dạng:

```json
{
  "success": false,
  "data": null,
  "message": "Dữ liệu không hợp lệ",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [{ "field": "price", "message": "price phải >= 0" }],
    "requestId": "8f0c…"
  }
}
```

- Mã lỗi nằm trong `src/common/errors/error-code.ts` (phase0/05-API-CONVENTIONS.md mục 4). Client xử lý theo `error.code`, không theo câu chữ.
- Lỗi nghiệp vụ: `throw new AppException(ErrorCode.BUSINESS_RULE_VIOLATION, 'Câu thông báo', details?)`. Không truyền câu thông báo thì dùng câu mặc định của mã lỗi.
- Exception có sẵn của NestJS (`NotFoundException`…) đổi sang mã lỗi theo HTTP status, dùng câu thông báo mặc định.
- Lỗi PostgreSQL: trùng unique, vướng khoá ngoại → 409 `CONFLICT`; vi phạm check, sai kiểu (vd uuid sai) → 400 `VALIDATION_ERROR`. Không trả tên bảng, tên constraint cho client.
- JSON sai cú pháp → 400 `VALIDATION_ERROR`.
- Lỗi khác → 500 `INTERNAL_ERROR` với câu thông báo chung; log server ghi đủ stack kèm request id, client không nhận stack.
- Mỗi request có header `X-Request-Id`: dùng lại id client gửi nếu an toàn (chữ, số, `-_.:`, tối đa 100 ký tự), không thì tự sinh UUID. Id này cũng nằm trong `error.requestId`.

## Kiểm tra dữ liệu request (TASK-032)

- Mỗi endpoint nhận dữ liệu qua DTO viết bằng `class-validator` + `class-transformer`. `ValidationPipe` toàn cục (`src/common/validation/validation.pipe.ts`) chạy cho body, query và param:
  - trường không khai báo trong DTO (kể cả `tenantId`) → 400;
  - dữ liệu được đổi sang instance của DTO; số trong query cần `@Type(() => Number)`;
  - lỗi trả 400 `VALIDATION_ERROR`, `details` liệt kê từng trường (trường lồng nhau dạng `address.street`), không gửi lại giá trị client đã nhập.
- Tham số `:id` dùng `@Param('id', ParseUuidPipe)`: không phải UUID → 400, không chạm database.
- Chuỗi tự do: luôn có `@MaxLength(...)`, thêm `@NoHtml()` để từ chối HTML (lưu text thuần).

## Định dạng response thành công (TASK-033)

Controller chỉ trả dữ liệu; `ResponseInterceptor` (`src/common/response/`) tự bọc lại:

```json
{ "success": true, "data": { "id": "…" }, "message": null }
```

- Danh sách có phân trang: nhận query qua `PaginationQueryDto` (`?page=1&pageSize=20`, `pageSize` tối đa 100; DTO danh sách kế thừa class này), trả `new Paginated(items, page, pageSize, total)`:

  ```json
  {
    "success": true,
    "data": [],
    "message": null,
    "meta": { "page": 1, "pageSize": 20, "total": 342, "totalPages": 18 }
  }
  ```

- Không trả gì → `data: null`. Response 204 (vd DELETE với `@HttpCode(204)`) không có body.
- Lỗi theo định dạng ở mục Xử lý lỗi, không bị bọc lại.

## Logging (TASK-034)

- Dùng logger của NestJS ở chế độ JSON (`src/common/logging/app-logger.ts`), mỗi dòng một object:

  ```json
  {
    "level": "log",
    "timestamp": 1791110292315,
    "message": "GET /api/v1/properties 200",
    "context": "HTTP",
    "method": "GET",
    "path": "/api/v1/properties",
    "statusCode": 200,
    "durationMs": 12.4,
    "requestId": "…",
    "tenantId": "…",
    "userId": "…"
  }
  ```

- Mỗi request ghi một dòng khi kết thúc (method, đường dẫn, status, thời gian xử lý). Không ghi query string, header hay body.
- Mọi log trong request tự kèm `requestId`; `tenantId`, `userId` được thêm khi request đã xác thực (gắn vào request context ở TASK-047, qua `getRequestContext()`).
- Ghi log trong code: `private readonly logger = new Logger(TenService.name)`, dữ liệu kèm theo truyền dạng object: `this.logger.log('Đã duyệt BĐS', { propertyId })`.
- Trường nhạy cảm (`password`, `token`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `secret`…) trong object log được thay bằng `[REDACTED]`. Không đưa dữ liệu nhạy cảm vào câu log dạng chuỗi.
- Lỗi 500 ghi mức `error` kèm stack; client chỉ nhận câu thông báo chung.
- Mức log chỉnh bằng `LOG_LEVEL`.

## Health check (TASK-035)

`GET /api/v1/health`: không cần đăng nhập, dùng cho Docker, load balancer, giám sát.

- Database trả lời `SELECT 1` trong 3 giây → 200 `{ "success": true, "data": { "status": "ok", "db": "up" }, "message": null }`.
- Database tắt hoặc treo → 503, body theo định dạng lỗi (`INTERNAL_ERROR`), không lộ chi tiết lỗi.

## Đăng ký công khai (TASK-036)

`POST /api/v1/auth/register` (không cần đăng nhập) tạo một công ty mới cùng tài khoản quản trị đầu tiên. Đây là quyết định của người dùng ngày 2026-10-04, thay cho mục Q4 của Phase 0 ("chỉ admin tạo user").

```json
{
  "companyName": "Công ty BĐS An Phát",
  "fullName": "Nguyễn Văn An",
  "email": "an@anphat.vn",
  "phone": "+84901234567",
  "password": "ít nhất 8 ký tự"
}
```

- Cần ít nhất một trong `email`/`phone`. `phone` theo dạng quốc tế (`+84…`). Email và SĐT là duy nhất toàn hệ thống; bị trùng thì trả 409 `CONFLICT` kèm trường bị trùng.
- Trong một transaction: công ty (ACTIVE, slug sinh từ tên, trùng thì thêm hậu tố), 6 role mặc định kèm quyền theo phase0/04-RBAC.md (`src/auth/default-roles.ts`, test kiểm tra khớp với `database/src/seed.ts`), user ACTIVE, gán role `COMPANY_ADMIN`.
- Mật khẩu băm Argon2id (`@node-rs/argon2`), không trả về, không ghi log.
- Trả 201 với `user` và `company`, không trả token: đăng nhập ở TASK-037.
