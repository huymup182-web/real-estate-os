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

| Biến           | Mặc định      | Kiểm tra                                                               |
| -------------- | ------------- | ---------------------------------------------------------------------- |
| `PORT`         | `3000`        | Số nguyên 1–65535                                                      |
| `NODE_ENV`     | `development` | `development` \| `production` \| `test`                                |
| `DATABASE_URL` | (bắt buộc)    | Dạng `postgresql://USER:PASSWORD@HOST:PORT/DB`                         |
| `JWT_SECRET`   | (bắt buộc)    | ≥ 32 ký tự; production không được dùng khoá dev của `.env.development` |
| `LOG_LEVEL`    | `log`         | `fatal` \| `error` \| `warn` \| `log` \| `debug` \| `verbose`          |

Sai giá trị thì ứng dụng dừng ngay khi khởi động.

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
- Mọi log trong request tự kèm `requestId`; `tenantId`, `userId` được thêm khi request đã xác thực (`JwtAuthGuard` gắn vào request context, đọc qua `getRequestContext()`).
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

## Đăng nhập (TASK-037)

`POST /api/v1/auth/login` với `{ "identifier": "email hoặc +84…", "password": "…" }`:

- `identifier` có `@` thì tìm theo email (không phân biệt hoa thường), còn lại tìm theo số điện thoại.
- Sai email/SĐT/mật khẩu, hoặc tài khoản đã xoá → 401 `UNAUTHENTICATED`, luôn cùng một câu thông báo để không lộ tài khoản nào tồn tại. Khi không có tài khoản vẫn chạy so mật khẩu giả để thời gian phản hồi tương đương.
- Đúng mật khẩu nhưng tài khoản bị khoá/ngừng hoạt động, hoặc công ty bị tạm ngưng → 403 `FORBIDDEN`.
- Thành công → 200 `{ accessToken, refreshToken, expiresIn, user: { id, tenantId, fullName, email, phone } }` và ghi `last_login_at`. Refresh token xem mục TASK-040.

## Mật khẩu (TASK-038)

`src/auth/password.ts` là nơi duy nhất băm/so mật khẩu:

- Argon2id với tham số ghi rõ trong code (`ARGON2_OPTIONS`: 19 MiB, 2 vòng, 1 luồng — mức tối thiểu OWASP), salt ngẫu nhiên mỗi lần băm. `@node-rs/argon2` có sẵn bản build cho Linux (glibc và musl/Alpine), macOS, Windows nên không cần biên dịch khi build Docker.
- Mật khẩu được chuẩn hoá Unicode NFKC trước khi băm/so, để mật khẩu tiếng Việt có dấu gõ từ bộ gõ khác nhau vẫn khớp. Seed (`database/src/seed.ts`) chuẩn hoá giống vậy.
- Độ dài 8–128 ký tự khi đăng ký.
- Đổi `ARGON2_OPTIONS` thì mật khẩu cũ được băm lại tự động lần đăng nhập thành công tiếp theo (`needsRehash`).

## Access token & xác thực (TASK-039)

- Đăng nhập trả `accessToken` (JWT HS256, ký bằng `JWT_SECRET`, sống 15 phút, `expiresIn` = 900 giây). Token chỉ chứa `sub` (user id), `tid` (tenant id, null với tài khoản nền tảng), `sid` (phiên đăng nhập, TASK-040), `iat`, `exp`; không chứa permission (phase0/02-ARCHITECTURE.md).
- `JwtAuthGuard` chạy toàn cục: **mọi route cần đăng nhập** (`Authorization: Bearer <accessToken>`), trừ route đánh dấu `@Public()` (đăng ký, đăng nhập, health check). Route mới mặc định được bảo vệ.
- Token thiếu, sai chữ ký, sai thuật toán (chỉ nhận HS256, từ chối `none`), thiếu `sub`/`tid`/`sid` → 401 `UNAUTHENTICATED`. Token hết hạn → 401 `TOKEN_EXPIRED` (client gọi refresh, TASK-040).
- Token hợp lệ → `req.user = { userId, tenantId, sessionId }` và request context có `userId`/`tenantId`. tenantId chỉ lấy từ token, không bao giờ từ body/query.
- Guard chỉ kiểm token; kiểm user/công ty còn hoạt động và quyền làm ở TASK-045–047.

## Refresh token (TASK-040)

- Đăng nhập mở một phiên mới và trả thêm `refreshToken`: chuỗi ngẫu nhiên 256 bit (base64url, 43 ký tự), sống 30 ngày. DB chỉ lưu SHA-256 của token (`refresh_tokens.token_hash`), kèm User-Agent (`device_info`, tối đa 255 ký tự) và IP.
- Mỗi lần đăng nhập là một phiên (`family_id`); `sid` trong access token chính là `family_id`.
- `POST /api/v1/auth/refresh` `{ refreshToken }` → 200 `{ accessToken, refreshToken, expiresIn }`. Token cũ bị thu hồi (`revoked_at`) và trỏ `replaced_by` tới token mới; token mới sống thêm 30 ngày kể từ lúc refresh.
- Token không tồn tại, hết hạn, đã thu hồi, hoặc user đã xoá → 401 `UNAUTHENTICATED`. User bị khoá hoặc công ty tạm ngưng → 403 `FORBIDDEN` (token không bị dùng mất).
- **Phát hiện dùng lại:** token đã bị thay thế mà còn được gửi lên (có thể bị đánh cắp) → thu hồi mọi token của phiên đó, ghi log cảnh báo (chỉ có userId và familyId), trả 401. Các phiên khác của user không bị ảnh hưởng.
- Client phải gọi refresh tuần tự: hai request refresh đồng thời với cùng một token thì request sau bị coi là dùng lại và cả phiên bị thu hồi.

## Đăng xuất (TASK-041)

- `POST /api/v1/auth/logout` (cần `Authorization: Bearer <accessToken>`) → 204 không có body. Thu hồi mọi refresh token còn hiệu lực của phiên hiện tại (`sid` trong access token), kể cả các token đã sinh ra do xoay vòng. Các phiên khác của user không bị ảnh hưởng.
- Gọi lại khi phiên đã thu hồi vẫn trả 204. Thiếu hoặc sai access token → 401.
- Access token đã cấp vẫn dùng được tới khi hết hạn (tối đa 15 phút) vì guard chỉ kiểm chữ ký; client phải xoá cả hai token khi đăng xuất.
- `register`, `login`, `refresh` đánh dấu `@Public()` từng route; route mới thêm vào `AuthController` mặc định cần đăng nhập.

## Quên mật khẩu (TASK-042)

- `POST /api/v1/auth/forgot-password` `{ email }` (công khai) → 200 `{ expiresIn: 900 }`. Luôn trả **cùng một kết quả** dù email có tài khoản hay không, để không lộ email nào đã đăng ký.
- Email thuộc tài khoản đang hoạt động (công ty cũng đang hoạt động) → sinh mã OTP 6 số, sống 15 phút, gửi qua SMTP. DB chỉ lưu SHA-256 của `userId:mã` (`password_reset_tokens.code_hash`). Mã mới làm các mã cũ chưa dùng của user hết hiệu lực. Tài khoản bị khoá, đã xoá hoặc công ty tạm ngưng thì không gửi.
- Email gửi nền, không chờ SMTP; gửi lỗi chỉ ghi log (không ghi mã hay nội dung email).
- Đặt mật khẩu mới bằng mã: xem mục TASK-043.
- Tài khoản chỉ có số điện thoại chưa quên mật khẩu được (chưa có SMS).

## Đặt lại mật khẩu (TASK-043)

- `POST /api/v1/auth/reset-password` `{ email, code, newPassword }` (công khai) → 204.
- Chỉ mã mới nhất còn hạn, chưa dùng của user được chấp nhận. Mã sai → tăng `attempts`; sai đủ 5 lần thì mã bị huỷ, phải xin mã mới.
- Mã đúng → mật khẩu mới (8–128 ký tự, argon2id) được lưu, mã bị đánh dấu đã dùng và **mọi phiên đăng nhập** của user bị thu hồi (refresh token cũ không dùng được nữa).
- Mọi trường hợp thất bại (email không có tài khoản, tài khoản không hoạt động, không có mã, mã sai/hết hạn/đã huỷ) → cùng một lỗi 400 `VALIDATION_ERROR` với `details[0].field = "code"`.
- Mật khẩu mới chỉ được băm khi mã đúng, để request đoán mã không tốn CPU.

### Gửi email (`src/mail`)

- `MailService.send({ to, subject, text })` dùng nodemailer qua SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, xem docs/environment.md). Production bắt buộc `SMTP_HOST`; môi trường khác để trống thì bỏ qua gửi và ghi cảnh báo.
- Dev: `docker compose up mailpit` rồi xem thư tại http://localhost:8025 (`.env.development` đã trỏ SMTP tới `localhost:1025`).

## User hiện tại (TASK-044)

- `GET /api/v1/auth/me` (cần access token) → 200 `{ user, company, roles, permissions }`:
  - `user`: `id, tenantId, fullName, email, phone, avatarUrl, departmentId, status`.
  - `company`: `{ id, name, slug }`, `null` với tài khoản nền tảng.
  - `roles`: `[{ code, name }]` các role chưa xoá của user.
  - `permissions`: `[{ code, scope }]` quyền hiệu lực = hợp permission của mọi role, mỗi quyền lấy scope rộng nhất (`OWN < TEAM < DEPARTMENT < COMPANY < PLATFORM`, phase0/04-RBAC.md). Client chỉ dùng để ẩn/hiện UI; backend vẫn tự kiểm quyền (TASK-046).
- Đọc lại từ DB mỗi lần gọi: user đã xoá hoặc không còn thuộc công ty trong token → 401; user bị khoá hoặc công ty tạm ngưng → 403.
- `PermissionService.getEffectivePermissions(userId)` (`src/auth/permission.service.ts`) được export để guard phân quyền dùng lại; chưa có cache.
- Đường dẫn theo phase0/04-RBAC.md và 05-API-CONVENTIONS (`/auth/me`); roadmap ghi tắt là `GET /me`.

## Role và quyền trong request (TASK-045)

- Sau khi `JwtAuthGuard` xác thực token, `req.user` (kiểu `RequestUser`) có thêm:
  - `roles`: mã các role chưa xoá của user (chỉ để hiển thị/ghi log).
  - `permissions`: object `permission code → scope rộng nhất`, vd `{ "property.edit": "TEAM" }`. Không có key = không có quyền.
- Không có chỗ nào kiểm quyền theo **tên role** (phase0/04-RBAC.md mục 1): guard phân quyền ở TASK-046 chỉ đọc `req.user.permissions`.
- `PermissionService.getUserAccess(userId)` cache trong process 60 giây (`ACCESS_CACHE_TTL_MS`). Đổi role/quyền trực tiếp trong DB có hiệu lực chậm nhất sau 60 giây; API đổi role/quyền (sau này) phải gọi `invalidate(userId)` hoặc `invalidate()` để có hiệu lực ngay.
- `GET /auth/me` vẫn đọc mới từ DB, không qua cache.

## Kiểm quyền (TASK-046)

```ts
@Get()
@RequirePermission('customer.view')
list(@GrantedScope() scope: PermissionScope) { … } // scope: OWN | TEAM | DEPARTMENT | COMPANY
```

- `@RequirePermission(code)` (`src/auth/permission.guard.ts`) đặt trên handler hoặc controller (handler ghi đè controller). `PermissionGuard` chạy sau `JwtAuthGuard`, đọc `req.user.permissions` (TASK-045): không có quyền → 403 `FORBIDDEN`.
- `@GrantedScope()` trả scope của quyền đó để service áp vào truy vấn (vd `OWN` → chỉ bản ghi mình phụ trách). Áp scope vào truy vấn làm ở từng module nghiệp vụ.
- Chỉ kiểm theo permission, không theo tên role. Permission mới thêm bằng migration seed, không sửa guard.
- Route không có `@RequirePermission` chỉ cần đăng nhập. `@Public()` kèm `@RequirePermission` là cấu hình sai và bị chặn (401).
