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

## Tách dữ liệu theo công ty — tenant isolation (TASK-047)

Ba lớp theo phase0/02-ARCHITECTURE.md mục 3:

1. **Tenant từ token**: `JwtAuthGuard` lấy `tenantId` từ access token, không bao giờ từ body/query (body có `tenantId` bị chặn 400 vì `forbidNonWhitelisted`).
2. **`TenantGuard`** (`src/auth/tenant.guard.ts`, guard toàn cục chạy ngay sau `JwtAuthGuard`): mỗi request đã đăng nhập đọc lại user trong DB (không cache):
   - user đã xoá, hoặc `tenant_id` trong DB khác tenant trong token → 401;
   - user không `ACTIVE` hoặc công ty không `ACTIVE` → 403. Khoá tài khoản/tạm ngưng công ty có hiệu lực ngay, không phải chờ access token hết hạn.
3. **Repository bắt buộc tenant**: handler lấy tenant bằng `@TenantId()` rồi truyền cho `TenantRepository` (TASK-030), mọi truy vấn tự thêm `tenant_id`. Tài khoản nền tảng (không thuộc công ty) gọi route có `@TenantId()` → 403.

```ts
@Get(':id')
@RequirePermission('customer.view')
async get(@TenantId() tenantId: string, @Param('id', ParseUuidPipe) id: string) {
  const customer = await this.customers.findById(tenantId, id); // bản ghi công ty khác → null
  if (!customer) throw new NotFoundException(); // 404, không lộ bản ghi có tồn tại
  …
}
```

- `test/tenant-isolation.spec.ts` là mẫu test cô lập: 2 công ty, chứng minh công ty A không đọc/sửa/xoá được dữ liệu công ty B. Mỗi module nghiệp vụ sau này phải có test tương tự.
- Chi phí: thêm 1 truy vấn theo khoá chính mỗi request đã đăng nhập.

## Test auth (TASK-048)

`npm test` chạy toàn bộ test auth trên DB thật (`_backend_test`), gọi HTTP thật vào app:

| Phần                                                                                                                                                                  | File test                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Hành trình đầy đủ: đăng ký → đăng nhập → `/me` → refresh → quên/đặt lại mật khẩu (thu hồi mọi phiên) → đăng nhập mật khẩu mới → đăng xuất → công ty tạm ngưng bị chặn | `test/auth-flow.spec.ts`                              |
| Đăng ký, đăng nhập, mật khẩu (argon2)                                                                                                                                 | `auth-register`, `auth-login`, `password`             |
| Access token, refresh token (xoay vòng, phát hiện dùng lại), đăng xuất                                                                                                | `auth-token`, `auth-refresh`, `auth-logout`           |
| Quên/đặt lại mật khẩu, gửi email                                                                                                                                      | `auth-forgot-password`, `auth-reset-password`, `mail` |
| User hiện tại, quyền hiệu lực (nhiều role → scope rộng nhất), quyền trong request                                                                                     | `auth-me`, `auth-role-context`                        |
| Kiểm quyền, tách dữ liệu theo công ty                                                                                                                                 | `permission-guard`, `tenant-isolation`                |

Test e2e theo scope trên dữ liệu nghiệp vụ (AGENT không sửa BĐS của người khác, TEAM_LEADER sửa được trong nhóm, COLLABORATOR không thấy khách của người khác — phase0/04-RBAC.md mục 7) sẽ viết cùng module BĐS/khách hàng.

## Tạo BĐS (TASK-049)

`POST /api/v1/properties` → 201 BĐS vừa tạo. Cần quyền `property.create` (mọi role mặc định đều có, scope COMPANY).

- Bắt buộc: `title`, `propertyType`, `price` (số nguyên, đồng), `area` (m², tối đa 2 số lẻ), `provinceId`, `wardId`. Các trường khác tuỳ chọn; `latitude`/`longitude` và `commissionType`/`commissionValue` phải gửi theo cặp, hoa hồng `PERCENT` ≤ 100.
- Backend tự gán: `code` (`BDS-000001`… đếm riêng theo công ty, bảng `property_code_counters`), `status = AVAILABLE`, `verificationStatus = UNVERIFIED`, `transactionType = SALE`, môi giới phụ trách và người tạo là user đang đăng nhập, `tenant_id` lấy từ token.
- Client gửi `tenantId`, `code`, `status`, `agentId`, `ownerId`, `transactionType` → 400 (đổi trạng thái, chủ nhà, phân môi giới làm ở TASK-054..056).
- Tỉnh, phường/xã (và quận/huyện nếu gửi) phải tồn tại, đang dùng và cùng tỉnh, sai → 400 chỉ rõ trường.
- Mã nguồn: `src/properties/` (entity, DTO, service, controller). Test: `test/properties-create.spec.ts`.

## Xem chi tiết BĐS (TASK-050)

`GET /api/v1/properties/:id` → chi tiết BĐS. Cần quyền `property.view`.

- Phạm vi `property.view` áp vào truy vấn: BĐS ngoài phạm vi, đã xoá mềm hoặc thuộc công ty khác → 404 (không lộ có tồn tại). id sai định dạng → 400.
- Địa chỉ chi tiết (`streetAddress`), `ownerId` và `owner` (`{ id, fullName, phone, email, notes }`) chỉ trả khi BĐS nằm trong phạm vi `property.view_owner_contact` của user; nếu không thì là `null` và `ownerContactVisible = false` (phase0/04-RBAC.md, Q5). Toạ độ luôn trả để cắm điểm bản đồ (Huy Lê chọn ngày 2026-10-04).
- Phạm vi dùng chung ở `src/auth/record-scope.ts` (`scopeCondition`), theo người phụ trách/người tạo của bản ghi:
  - `OWN`: mình phụ trách hoặc mình tạo;
  - `TEAM`: thêm BĐS của thành viên và trưởng nhóm các team mình thuộc hoặc làm trưởng nhóm;
  - `DEPARTMENT`: thêm BĐS của user cùng phòng ban (`users.department_id`);
  - `COMPANY`: mọi BĐS trong công ty.
- Có thêm `provinceName`, `wardName` (TASK-121) để app không phải tải danh mục địa giới, và `canEdit` (TASK-123): BĐS nằm trong phạm vi `property.edit` của người xem (app dùng để hiện nút sửa; backend vẫn kiểm khi sửa).
- Test: `test/properties-get.spec.ts` (AGENT, TEAM_LEADER, MANAGER, COLLABORATOR, role tuỳ chỉnh phạm vi OWN, 2 công ty).

## Danh sách BĐS (TASK-051)

`GET /api/v1/properties?page=1&pageSize=20` → `data` (mảng) + `meta` `{ page, pageSize, total, totalPages }`. Cần quyền `property.view`.

- Chỉ gồm BĐS trong phạm vi `property.view` của user (cùng `scopeCondition` với chi tiết), chưa xoá mềm, mới tạo trước.
- Mỗi dòng giống chi tiết nhưng không có `owner`; `streetAddress`, `ownerId` ẩn theo phạm vi `property.view_owner_contact` (`ownerContactVisible`), toạ độ luôn có.
- `pageSize` tối đa 100. Tham số lạ (vd `status`) → 400: lọc, tìm kiếm, sắp xếp khác làm ở Phase 5 (TASK-064..074).
- Mỗi dòng có thêm `provinceName`, `wardName` và `coverImage` `{ url, thumbnailUrl }` (ảnh bìa, `null` nếu chưa có) để
  app hiện thẻ BĐS không phải gọi thêm (TASK-118). `GET /properties/favorites` cũng vậy.
- Test: `test/properties-list.spec.ts`.

## Sửa BĐS (TASK-052)

`PATCH /api/v1/properties/:id` → chi tiết BĐS sau khi sửa (cùng dạng `GET /properties/:id`). Cần quyền `property.edit`.

- Chỉ đổi trường được gửi; trường tuỳ chọn gửi `null` (hoặc chuỗi rỗng) để xoá; trường bắt buộc (`title`, `propertyType`, `price`, `area`, `provinceId`, `wardId`) không nhận `null`. Body rỗng → 400.
- Không sửa ở đây: `code`, `status`, `agentId`, `ownerId`, `transactionType`, xác minh (gửi lên → 400).
- Quyền theo bản ghi: ngoài phạm vi `property.view` → 404; xem được nhưng ngoài phạm vi `property.edit` → 403 (vd AGENT sửa BĐS của agent khác).
- Chống ghi đè: gửi `expectedUpdatedAt` (giá trị `updatedAt` đang có); BĐS đã bị sửa sau thời điểm đó → 409 `CONFLICT`. Không gửi thì ghi đè như bình thường.
- Toạ độ, hoa hồng (theo cặp, `PERCENT` ≤ 100) và địa giới được kiểm trên giá trị sau khi gộp với bản ghi hiện tại. Dòng BĐS bị khoá (`FOR UPDATE`) trong lúc sửa.
- Test: `test/properties-update.spec.ts`.

## Xoá BĐS (TASK-053)

`DELETE /api/v1/properties/:id` → 204, xoá mềm (`deleted_at`, người xoá ghi vào `updated_by`). Cần quyền `property.delete` (ma trận mặc định: COMPANY_ADMIN, DIRECTOR phạm vi công ty; MANAGER phạm vi phòng; TEAM_LEADER, AGENT, COLLABORATOR không có).

- Ngoài phạm vi `property.view`, đã xoá hoặc công ty khác → 404; xem được nhưng ngoài phạm vi `property.delete` → 403.
- BĐS đã xoá không còn trong chi tiết, danh sách, sửa. Ảnh, giấy tờ, lịch hẹn, giao dịch của BĐS giữ nguyên trong database.
- Sửa và xoá dùng chung `lockForAction` (khoá dòng + kiểm phạm vi theo bản ghi).
- Test: `test/properties-delete.spec.ts`.

## Trạng thái BĐS (TASK-054)

`POST /api/v1/properties/:id/status` body `{ status, expectedUpdatedAt? }` → 200 chi tiết BĐS. Cần quyền `property.edit` với BĐS đó (404/403 như khi sửa). Quy tắc do Huy Lê chọn ngày 2026-10-04:

- Người dùng chuyển tự do giữa `AVAILABLE`, `PENDING`, `SOLD`, `HIDDEN`. `EXPIRED`, `VERIFY_REQUIRED` chỉ hệ thống đặt (gửi lên → 400).
- BĐS đang `EXPIRED`/`VERIFY_REQUIRED` không mở bán lại (`AVAILABLE`, `PENDING`) được → 422 `BUSINESS_RULE_VIOLATION`, phải xác minh (TASK-062); vẫn đặt `SOLD`/`HIDDEN` được.
- Đặt lại trạng thái đang có → 200, không ghi gì. `expectedUpdatedAt` cũ → 409.
- BĐS `HIDDEN` chỉ người có `property.edit` với BĐS đó thấy (chi tiết, danh sách, sửa, xoá); người khác nhận 404 như BĐS không tồn tại.
- Luật chuyển ở `src/properties/property-values.ts` (`canUserChangeStatus`). Test: `test/properties-status.spec.ts`.

## Chủ nhà của BĐS (TASK-055)

- `PUT /api/v1/properties/:id/owner` `{ fullName, phone, email?, notes?, expectedUpdatedAt? }` → 200, chi tiết BĐS. Nhập chủ nhà nếu BĐS chưa có, có rồi thì sửa đúng bản ghi đó. `phone` dạng quốc tế (`+84901234567`); `email`, `notes` không gửi, rỗng hoặc `null` thì để trống.
- `DELETE /api/v1/properties/:id/owner` → 204. Gỡ chủ nhà khỏi BĐS; bản ghi chủ nhà xoá mềm khi không còn BĐS nào dùng. BĐS chưa có chủ nhà thì không đổi gì.
- Quyền: cần cả `property.edit` lẫn `property.view_owner_contact` với BĐS đó. Không xem được BĐS → 404; thiếu một trong hai → 403. `expectedUpdatedAt` khác `updatedAt` của BĐS → 409.
- Mỗi BĐS có bản ghi chủ nhà riêng, không gộp theo số điện thoại (phương án mặc định, chờ Huy Lê xác nhận): cùng một người có 2 căn thì nhập 2 lần, sửa căn này không ảnh hưởng căn kia.

## Phân môi giới phụ trách BĐS (TASK-056)

- `POST /api/v1/properties/:id/assign` `{ agentId, expectedUpdatedAt? }` → 200, chi tiết BĐS với `agentId` mới; ghi người giao vào `updatedBy`. Giao lại đúng người đang phụ trách thì không đổi gì.
- Cần quyền riêng `property.assign` (Huy Lê chọn ngày 2026-10-04), thêm bằng migration `1791128000000-add-property-assign-permission`, ma trận như `customer.assign`: COMPANY_ADMIN, DIRECTOR cả công ty; MANAGER trong phòng; TEAM_LEADER trong nhóm; AGENT, COLLABORATOR không có. Migration gán luôn cho role mặc định của các công ty đã có.
- BĐS phải trong phạm vi xem (không thì 404) và trong phạm vi `property.assign` (không thì 403). Người nhận phải trong cùng phạm vi đó, ngoài phạm vi → 403.
- Người nhận không tồn tại, đã khoá, đã xoá hoặc thuộc công ty khác → 400 `agentId`. `expectedUpdatedAt` cũ → 409.
- Người tạo BĐS vẫn trong phạm vi OWN của BĐS đó sau khi giao (phase0/04-RBAC.md: OWN là mình phụ trách hoặc mình tạo).

## Ảnh BĐS (TASK-057)

Upload 3 bước, file không đi qua backend (phase0/02-ARCHITECTURE.md mục 4):

1. `POST /api/v1/properties/:id/images/upload-url` `{ mimeType, sizeBytes }` → 201 `{ imageId, uploadUrl, headers, expiresAt }`. Link có hạn 15 phút, ghi đúng vào `{tenant_id}/properties/{property_id}/{imageId}.{ext}`.
2. Client `PUT` file lên `uploadUrl` kèm `headers` (content-type đã ký, storage từ chối định dạng khác).
3. `POST /api/v1/properties/:id/images` `{ imageId, mimeType, width?, height? }` → 201 ảnh. Backend kiểm file có trên storage, đúng định dạng, tối đa 10MB (không thì 422); xác nhận lại → 409.

Các API khác:

- `GET /api/v1/properties/:id/images` → ảnh theo thứ tự, mỗi ảnh có `url` và `thumbnailUrl` (CDN nếu có `STORAGE_PUBLIC_URL`, không thì link có hạn 1 giờ).
- `PUT /api/v1/properties/:id/images/order` `{ imageIds }` → phải gửi đúng toàn bộ ảnh hiện có (không thì 400).
- `POST /api/v1/properties/:id/images/:imageId/cover` → đổi ảnh bìa. Ảnh đầu tiên tự là ảnh bìa.
- `DELETE /api/v1/properties/:id/images/:imageId` → 204, xoá mềm (file giữ trên storage). Xoá ảnh bìa thì ảnh đầu còn lại thành ảnh bìa.

Luật: định dạng jpeg/png/webp/heic, tối đa 10MB/ảnh và 30 ảnh/BĐS (phase0/05-API-CONVENTIONS.md mục 9, vượt → 422). Xem ảnh theo quyền xem BĐS; thêm, sắp xếp, đổi ảnh bìa, xoá cần `property.edit` với BĐS (ngoài phạm vi → 403, không xem được → 404). Cấu hình storage: biến `STORAGE_*` trong docs/environment.md.

Thumbnail (thư viện `sharp`, Huy Lê duyệt ngày 2026-10-04): sau khi xác nhận, backend tạo nền ảnh webp cạnh dài tối đa 480px tại `{imageId}_thumb.webp` cùng thư mục. Trong lúc tạo hoặc khi không tạo được (vd HEIC, `sharp` bản dựng sẵn không đọc được) thì `thumbnailUrl = null`, ảnh gốc vẫn dùng bình thường.

## Giấy tờ BĐS (TASK-058)

Upload 3 bước như ảnh (TASK-057), file nằm dưới `{tenant_id}/properties/{property_id}/documents/`:

1. `POST /api/v1/properties/:id/documents/upload-url` `{ documentType, fileName, mimeType, sizeBytes }` → 201 `{ documentId, uploadUrl, headers, expiresAt }`.
2. Client `PUT` file lên `uploadUrl` kèm `headers`.
3. `POST /api/v1/properties/:id/documents` `{ documentId, documentType, fileName, mimeType }` → 201 giấy tờ. File phải có trên storage, đúng định dạng, tối đa 10MB (không thì 422); xác nhận lại → 409.

- `GET /api/v1/properties/:id/documents` → giấy tờ, mới trước. `url` là link tải ký riêng có hạn 5 phút, luôn qua storage (không qua CDN), tải về với tên file gốc.
- `DELETE /api/v1/properties/:id/documents/:documentId` → 204, xoá mềm (file giữ trên storage).

Luật:

- Loại giấy tờ: `LAND_CERTIFICATE`, `CONSTRUCTION_PERMIT`, `SURVEY_MAP`, `SALE_CONTRACT`, `DEPOSIT_CONTRACT`, `BROKERAGE_AGREEMENT`, `OWNER_ID_DOCUMENT` (CCCD chủ nhà), `OTHER`. Định dạng pdf, jpeg, png, webp, heic. Tối đa 10MB/file, 30 giấy tờ/BĐS.
- `fileName` không rỗng, tối đa 255 ký tự, không chứa `/`, `\`, ký tự điều khiển hay HTML.
- Xem cần `property.view_documents` với BĐS (thiếu → 403). Thêm, xoá cần thêm `property.edit`.
- CCCD chủ nhà cần thêm `property.view_owner_contact`: thiếu thì không thấy trong danh sách, xoá → 404, thêm → 403.
- Không xem được BĐS → 404.

## BĐS yêu thích (TASK-059)

- `PUT /api/v1/properties/:id/favorite` → 204, lưu BĐS vào yêu thích của chính user. Cần xem được BĐS (không thì 404); lưu lại lần nữa không đổi gì.
- `DELETE /api/v1/properties/:id/favorite` → 204, bỏ khỏi yêu thích. Không cần xem được BĐS (bỏ được cả BĐS đã ẩn); chưa lưu thì không đổi gì.
- `GET /api/v1/properties/favorites?page=1&pageSize=20` → BĐS yêu thích, mới lưu trước, cùng dạng với danh sách BĐS. Chỉ gồm BĐS user vẫn xem được: BĐS đã xoá, bị ẩn hay ra khỏi phạm vi xem thì không hiện (hiện lại khi xem được lại).
- Chi tiết và danh sách BĐS có thêm `isFavorite` theo người đang xem.
- Cả ba API cần `property.view`. Yêu thích là của riêng từng user, người khác không thấy.

## Lượt xem BĐS (TASK-060)

- Mỗi lần `GET /api/v1/properties/:id` thành công ghi một lượt xem vào `property_views`. Cùng một người mở lại trong 30 phút chỉ tính một lần. Sửa, đổi trạng thái, danh sách, mở thất bại (404) không ghi.
- `GET /api/v1/properties/:id/views` → `{ totalViews, uniqueViewers, last7DaysViews, lastViewedAt }`. Chỉ người sửa được BĐS (phụ trách, cấp quản lý trong phạm vi `property.edit`) xem được: ngoài phạm vi → 403, không xem được BĐS → 404.

## Chia sẻ BĐS cho khách (TASK-061)

- `POST /api/v1/properties/:id/share-links` `{ expiresInDays? }` (1–90, mặc định 30) → 201 `{ id, token, expiresAt, createdAt }`. Ai xem được BĐS (`property.view`) thì tạo được; BĐS đang ẩn → 422. `token` chỉ trả lần này, database chỉ lưu SHA-256 của nó.
- `GET /api/v1/properties/:id/share-links` → link của BĐS, mới trước (`viewCount`, `active`, `revokedAt`, không có token). Người sửa được BĐS thấy mọi link, người khác chỉ link mình tạo.
- `DELETE /api/v1/properties/:id/share-links/:linkId` → 204, thu hồi. Người tạo link hoặc người sửa được BĐS; người khác → 403.
- `GET /api/v1/shared-properties/:token` (không cần đăng nhập) → mã, tiêu đề, mô tả, loại, giá, diện tích, phòng, hướng, đường, pháp lý, tên tỉnh/quận/phường, ảnh và liên hệ của môi giới tạo link. Không trả chủ nhà, địa chỉ chi tiết, toạ độ, hoa hồng. Mỗi lần mở thành công tăng `viewCount`. Link sai, hết hạn, đã thu hồi, BĐS ẩn hoặc đã xoá, công ty tạm dừng, người tạo link bị khoá → 404.

## Xác minh BĐS (TASK-062)

- `POST /api/v1/properties/:id/verify` `{ expectedUpdatedAt? }` → 200 chi tiết BĐS. Cần `property.verify` với BĐS (AGENT: BĐS mình phụ trách, TEAM_LEADER: team, MANAGER: phòng, DIRECTOR/ADMIN: cả công ty); ngoài phạm vi → 403, không xem được → 404. Ghi `verificationStatus = VERIFIED`, `lastVerifiedAt`, `verifiedBy`. BĐS đang `VERIFY_REQUIRED` hoặc `EXPIRED` mở bán lại thành `AVAILABLE`; trạng thái khác giữ nguyên.
- Job `property-verification` (`@nestjs/schedule`, mỗi giờ): BĐS `AVAILABLE`/`PENDING` của công ty đang hoạt động, quá hạn xác minh (từ `last_verified_at`, chưa xác minh thì từ `created_at`) → `status = VERIFY_REQUIRED`, `verificationStatus = EXPIRED`. Hạn mặc định 30 ngày; công ty đặt riêng bằng `companies.settings.verify_interval_days` (số nguyên 1–365). Thông báo cho môi giới làm ở Phase 8.

## Nhật ký hoạt động BĐS (TASK-063)

- `src/audit`: `AuditService.record(manager, entry)` ghi `audit_logs` trong cùng transaction với thao tác, kèm request id, IP, user agent lấy từ request context. Không bao giờ ghi mật khẩu, token, tên/SĐT/email chủ nhà hay tên file giấy tờ.
- Hoạt động BĐS (`entity_type = 'property'`): `property.create`, `update` (chỉ trường thật sự đổi), `change_status`, `delete`, `set_owner`, `remove_owner` (chỉ id chủ nhà), `assign`, `verify`, `verification_expired` (job, không có người làm), `add_image`, `remove_image`, `reorder_images`, `set_cover_image`, `add_document`, `remove_document`, `create_share_link`, `revoke_share_link`. `changes` dạng `{ field: [cũ, mới] }`. Lượt xem và yêu thích không ghi.
- `GET /api/v1/properties/:id/activities?page&pageSize` → `[{ id, action, changes, user: { id, fullName } | null, createdAt }]`, mới trước. Chỉ người sửa được BĐS xem được (403); không xem được BĐS → 404. Địa chỉ chi tiết, toạ độ trong `changes` bị bỏ với người không xem được liên hệ chủ nhà.

## Tìm BĐS theo từ khoá (TASK-064)

- `GET /api/v1/properties?q=…` (tối đa 200 ký tự, kèm phân trang như cũ): ra BĐS có đúng mã (`BDS-000123`, không phân biệt hoa thường) hoặc có mọi từ trong tiêu đề, mô tả, địa chỉ. Gõ có dấu hay không dấu đều được (`immutable_unaccent` + `search_vector`, index GIN); từ cuối tìm theo tiền tố ("vinh ha" ra "Vĩnh Hải"). Tối đa 10 từ.
- Vẫn theo phạm vi xem như danh sách thường. Địa chỉ chi tiết chỉ dùng để tìm với BĐS trong phạm vi `property.view_owner_contact` của user; BĐS khác phải khớp tiêu đề hoặc mô tả.
- Lọc giá (TASK-065): `priceMin`, `priceMax` (số nguyên đồng, ≥ 0, gồm cả hai đầu), dùng riêng hoặc kèm `q`; `priceMin > priceMax`, giá âm hoặc không phải số nguyên → 400.
- Lọc diện tích (TASK-066): `areaMin`, `areaMax` (m², ≥ 0, tối đa 2 chữ số thập phân, gồm cả hai đầu); sai dạng hoặc `areaMin > areaMax` → 400. Các bộ lọc kết hợp với nhau bằng AND.
- Lọc khu vực (TASK-067): `provinceId`, `districtId` (quận/huyện cũ trước 07/2025), `wardId` (UUID). Lọc theo bản đồ (bán kính, khung) chưa làm vì toạ độ là thông tin giới hạn theo `property.view_owner_contact`.
- Lọc loại BĐS (TASK-068): `propertyType=HOUSE,APARTMENT` hoặc lặp tham số; khớp một trong các loại. Loại không có trong danh sách hoặc để trống → 400.
- Lọc số phòng (TASK-069): `bedroomsMin`, `bedroomsMax`, `bathroomsMin`, `bathroomsMax` (số nguyên ≥ 0, gồm cả hai đầu). BĐS chưa ghi số phòng không khớp khi có bộ lọc đó. Sai dạng hoặc min > max → 400.
- Lọc pháp lý (TASK-070): `legalStatus=PRIVATE_BOOK,SHARED_BOOK` hoặc lặp tham số; khớp một trong các giá trị (`PRIVATE_BOOK`, `SHARED_BOOK`, `PENDING_BOOK`, `SALE_CONTRACT`, `HANDWRITTEN`, `OTHER`). BĐS chưa ghi pháp lý không khớp. Giá trị lạ hoặc để trống → 400.
- Lọc hướng nhà (TASK-071): `direction=E,SE` hoặc lặp tham số; khớp một trong các hướng (`N`, `S`, `E`, `W`, `NE`, `NW`, `SE`, `SW`). BĐS chưa ghi hướng không khớp. Hướng lạ hoặc để trống → 400.
- Lọc độ rộng đường (TASK-072): `roadWidthMin`, `roadWidthMax` (mét, ≥ 0, tối đa 2 chữ số thập phân, gồm cả hai đầu). BĐS chưa ghi độ rộng đường không khớp. Sai dạng hoặc min > max → 400.
- Lọc đường vào (TASK-134): `roadAccess` một hoặc nhiều giá trị `CAR` \| `MOTORBIKE` \| `WALK` (`?roadAccess=CAR,MOTORBIKE`), khớp một trong các giá trị. BĐS chưa ghi đường vào không khớp. Giá trị lạ hoặc rỗng → 400.
- Sắp xếp (TASK-073): `sort=newest|price_asc|price_desc|area_asc|area_desc|relevance`. Mặc định `relevance` khi có `q` (đúng mã BĐS lên đầu, rồi khớp tiêu đề + mô tả nhiều hơn lên trước; không tính địa chỉ), không có `q` thì `newest`. Cùng giá trị thì BĐS mới hơn đứng trước. Giá trị khác → 400.
- Phân trang (TASK-074): `page` (1..10000), `pageSize` (1..100, mặc định 20); `meta` có `page`, `pageSize`, `total`, `totalPages`. Thứ tự luôn có mốc phụ (mới hơn trước, rồi id) nên chuyển trang không trùng, không sót. Quá trang cuối → `data` rỗng. Số trang ngoài khoảng → 400 (trước đây `page=1e20` gây lỗi 500).

## Hiệu năng tìm kiếm (TASK-076)

`npm run perf:search` sinh 100.000 BĐS cho một công ty (database riêng `<db>_backend_perf`) và đo các kiểu tìm kiếm qua HTTP. Truy vấn nào có p95 ≥ 1 giây thì báo lỗi. Cách đo và kết quả: [docs/search-performance.md](../docs/search-performance.md).

## Tìm kiếm đã lưu (TASK-075)

Module `src/notifications` (bảng `saved_searches`, phase0/02-ARCHITECTURE.md mục 2.1). Mọi route cần `property.view`; mỗi người chỉ thấy và sửa tìm kiếm của mình (người khác, cấp trên, công ty khác → 404).

- `POST /api/v1/saved-searches` `{name, filters, notify?}` → 201. `name` 1..100 ký tự, không HTML. `filters` là object cùng tham số với `GET /properties` (`q`, `priceMin`, `propertyType`…, `sort`), không gồm `page`/`pageSize`; kiểm bằng đúng schema đó, sai → 400 với `field` dạng `filters.priceMax`. Bộ lọc được lưu đã chuẩn hoá (trim, tách danh sách, đổi số). `notify` mặc định `true` (gửi thông báo làm ở Phase 8).
- `GET /api/v1/saved-searches` (phân trang, mới trước), `GET /:id`, `PATCH /:id` `{name?, filters?, notify?}` (`filters` thay toàn bộ; body rỗng → 400), `DELETE /:id` → 204 (xoá mềm).
- `GET /api/v1/saved-searches/:id/properties?page=&pageSize=` chạy lại tìm kiếm: kết quả như `GET /properties` với bộ lọc đã lưu, theo quyền xem hiện tại.
- Tối đa 50 tìm kiếm mỗi người → 422 khi vượt.
- `src/search`: `PropertySearchQueryDto` (bộ lọc dùng chung cho saved search, các bộ lọc khác thêm ở TASK-065..072), `keywordTsQuery()`.

## Khách hàng (TASK-077)

Module `src/customers` (bảng `customers`, docs/database.md mục 4.5). Phạm vi quyền xét theo môi giới phụ trách hoặc người tạo, như BĐS.

- `POST /api/v1/customers` (`customer.create`) `{fullName, phone, email?, purpose?, purchaseTimeline?, source?, notes?}` → 201. `phone` dạng quốc tế (`+84901234567`), không bắt buộc duy nhất. Người tạo là môi giới phụ trách, trạng thái `NEW`. Không nhận `agentId`, `status`, `lostReason` (TASK-079, TASK-082).
- `GET /api/v1/customers?q&status=NEW,CONTACTED&page&pageSize` (`customer.view`): khách trong phạm vi xem, mới tạo trước; `status` lọc theo bước pipeline (TASK-082). `q` (tối đa 100 ký tự, TASK-108) tìm theo tên, email (không phân biệt hoa thường) hoặc số điện thoại: bỏ ký tự không phải số và số 0 đầu, từ 3 chữ số trở lên thì khớp một đoạn trong số đã lưu. `GET /:id`: ngoài phạm vi, đã xoá hoặc công ty khác → 404.
- `PATCH /api/v1/customers/:id` (`customer.edit`): chỉ đổi trường được gửi, trường tuỳ chọn gửi `null` hoặc chuỗi rỗng để xoá; body rỗng → 400. Xem được nhưng ngoài phạm vi sửa → 403; `expectedUpdatedAt` lệch → 409.
- `DELETE /api/v1/customers/:id` (`customer.delete`) → 204, xoá mềm, ghi người xoá vào `updated_by`.
- `POST /api/v1/customers/:id/assign` (`customer.assign`, TASK-079) `{agentId, expectedUpdatedAt?}` → 200 khách sau khi giao. Cùng luật với phân BĐS: khách ngoài phạm vi xem → 404, ngoài phạm vi `customer.assign` → 403; người nhận phải là user đang hoạt động của công ty (không thì 400 `agentId`) và trong phạm vi đó (TEAM cùng nhóm, DEPARTMENT cùng phòng, COMPANY cả công ty), không thì 403. Giao lại đúng người đang phụ trách thì không đổi gì. Người tạo khách vẫn xem được khách (phạm vi OWN gồm người tạo). Ghi `customer.assign` vào `audit_logs`.
- Tạo, sửa (kèm `{field: [cũ, mới]}`), xoá đều ghi `audit_logs` (`entity_type = 'customer'`).

## Nhu cầu của khách (TASK-078)

Bảng `customer_preferences` (đầu vào matching Phase 7). Một khách có nhiều nhu cầu.

- `GET /api/v1/customers/:customerId/preferences` (`customer.view`, khách trong phạm vi xem, không thì 404) → mọi nhu cầu của khách, kể cả đang tắt, tạo trước đứng trước.
- `POST …/preferences` (`customer.edit` với khách, xem được mà ngoài phạm vi sửa → 403) → 201. Body: `transactionType` (`SALE` mặc định | `RENT`), `isActive` (mặc định `true`) và các tiêu chí `propertyTypes[]`, `budgetMin/Max` (đồng), `areaMin/Max` (m²), `bedroomsMin`, `provinceIds[]`, `districtIds[]`, `wardIds[]` (tối đa 50 mỗi loại, phải tồn tại và đang dùng), `directions[]`, `legalStatuses[]`, `minRoadAccess`. Giá trị theo đúng danh sách của BĐS. Cần ít nhất một tiêu chí; min ≤ max; mảng bỏ trùng, mảng rỗng = không đặt. Tối đa 20 nhu cầu mỗi khách → 422.
- `PATCH …/preferences/:id` chỉ đổi trường được gửi, `null` để bỏ tiêu chí, `expectedUpdatedAt` lệch → 409. `DELETE …/preferences/:id` → 204, xoá mềm. Nhu cầu không thuộc khách trong đường dẫn → 404.
- Thêm, sửa, xoá nhu cầu ghi `audit_logs` của khách (`customer.add_preference`, `customer.update_preference`, `customer.remove_preference`).

## Ghi chú khách hàng (TASK-080)

Ghi chú là dòng `type = 'NOTE'` trong `customer_activities` (timeline của khách, chỉ thêm: không sửa, không xoá). Khác với trường `notes` của khách (một đoạn mô tả chung, sửa qua `PATCH /customers/:id`).

- `POST /api/v1/customers/:customerId/notes` (`customer.edit` với khách) `{content, occurredAt?}` → 201 `{id, content, user: {id, fullName}, occurredAt, createdAt}`. `content` 1..5000 ký tự, không HTML. `occurredAt` là lúc việc xảy ra (mặc định lúc ghi), không được ở tương lai. Khách ngoài phạm vi xem → 404, xem được nhưng ngoài phạm vi sửa → 403.
- `GET /api/v1/customers/:customerId/notes?page&pageSize` (`customer.view`) → ghi chú của khách, xảy ra gần đây trước. Khách đã xoá → 404; ghi chú vẫn giữ trong database.

## Timeline khách hàng (TASK-081)

Mọi hoạt động chăm sóc khách nằm ở `customer_activities` (chỉ thêm, không sửa, không xoá). Code: `CustomerActivitiesService`, ghi dòng mới qua `insertCustomerActivity()` (`src/customers/customer-activity.record.ts`) trong transaction của thao tác.

- `POST /api/v1/customers/:customerId/activities` (`customer.edit` với khách) `{type, content?, propertyIds?, occurredAt?}` → 201 `{id, type, content, propertyIds, metadata, user: {id, fullName}, occurredAt, createdAt}`. `type` người dùng ghi được: `CALL`, `MESSAGE`, `PROPERTY_SENT`, `VIEWING`, `NEGOTIATION`, `DEPOSIT`, `NOTE`. `NOTE` bắt buộc `content`; `PROPERTY_SENT` bắt buộc `propertyIds` (1..20, bỏ trùng). BĐS gắn kèm phải là BĐS người ghi xem được, không thì 400 `propertyIds`. `occurredAt` không được ở tương lai.
- `STATUS_CHANGE`, `ASSIGNMENT` chỉ hệ thống ghi: giao khách (`POST /customers/:id/assign`) ghi `ASSIGNMENT` với `metadata {fromAgentId, toAgentId}`; chuyển bước pipeline ghi `STATUS_CHANGE` với `metadata {fromStatus, toStatus}` (lý do mất khách trong `content`).
- `GET /api/v1/customers/:customerId/activities?type=CALL,NOTE&page&pageSize` (`customer.view`) → timeline, xảy ra gần đây trước; `type` lọc theo loại. Ghi chú (TASK-080) là `type = NOTE` của cùng timeline và trả cùng dạng.

## Pipeline khách hàng (TASK-082)

Các bước: `NEW` → `CONTACTED` → `QUALIFIED` → `VIEWING` → `NEGOTIATING` → `DEPOSIT` → `WON` / `LOST`. Chuyển tự do giữa mọi bước, kể cả lùi bước và mở lại khách đã WON/LOST (Huy Lê chọn ngày 2026-10-09; luật ở `canChangeCustomerStatus`).

- `POST /api/v1/customers/:id/status` (`customer.edit` với khách) `{status, lostReason?, expectedUpdatedAt?}` → 200 khách sau khi chuyển. Sang `LOST` bắt buộc `lostReason` (1..1000 ký tự, không HTML), lưu vào khách; rời `LOST` thì xoá lý do; gửi `lostReason` với bước khác → 400. Đặt lại đúng bước đang có thì không đổi gì. Ghi `customer.change_status` vào `audit_logs` và `STATUS_CHANGE` lên timeline.
- `GET /api/v1/customers/pipeline` (`customer.view`) → `[{status, count}]` số khách trong phạm vi xem ở từng bước, đủ 8 bước theo thứ tự.

## Lịch hẹn (TASK-083)

Module `src/appointments` (bảng `appointments`, docs/database.md mục 4.7; đọc khách qua `CustomersService`, BĐS qua `PropertiesService`). Quyền `appointment.view` / `appointment.manage`, phạm vi xét theo môi giới của lịch hoặc người tạo.

- `POST /api/v1/appointments` (`appointment.manage`) `{customerId, propertyId, scheduledAt, durationMinutes?, location?, notes?}` → 201. Môi giới của lịch là người tạo, trạng thái `SCHEDULED`. Khách và BĐS phải là khách/BĐS người tạo xem được (không thì 400 `customerId`/`propertyId`). `scheduledAt` không ở quá khứ (cho lệch 5 phút); `durationMinutes` 1..1440.
- `GET /api/v1/appointments?from&to&customerId&propertyId&status&page&pageSize` (`appointment.view`) → lịch trong phạm vi xem, giờ hẹn sớm trước; `from` gồm, `to` không gồm, `from` ≥ `to` → 400. `GET /:id`: ngoài phạm vi → 404. Mỗi lịch kèm `customer {id, fullName}` và `property {id, code, title}`.
- `PATCH /api/v1/appointments/:id` (`appointment.manage`): đổi `propertyId`, `scheduledAt`, `durationMinutes`, `location`, `notes` (`null` để xoá trường tuỳ chọn); xem được nhưng ngoài phạm vi quản lý → 403; `expectedUpdatedAt` lệch → 409. Không đổi khách (tạo lịch mới), không đổi trạng thái (dùng `/status`).
- `DELETE /api/v1/appointments/:id` (`appointment.manage`) → 204, xoá mềm. Tạo, sửa, xoá ghi `audit_logs` (`entity_type = 'appointment'`).

## Trạng thái buổi xem (TASK-084)

Giá trị trong `src/appointments/appointment-values.ts`: trạng thái `SCHEDULED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`; kết quả `INTERESTED`, `NOT_INTERESTED`, `NEED_FOLLOW_UP`, `NEGOTIATING`.

- `POST /api/v1/appointments/:id/status` (`appointment.manage`) `{status, outcome?, expectedUpdatedAt?}` → 200 kèm lịch đã cập nhật. Ngoài phạm vi xem → 404, xem được nhưng ngoài phạm vi quản lý → 403, `expectedUpdatedAt` lệch → 409.
- Chuyển trạng thái tự do (mở lại được lịch đã huỷ), nhưng `COMPLETED` và `NO_SHOW` chỉ đặt được khi đã tới giờ hẹn (cho lệch 5 phút), chưa tới → 422.
- `outcome` chỉ gửi kèm `COMPLETED` (trạng thái khác → 400) và không bắt buộc (Huy Lê chọn ngày 2026-10-09, cờ `OUTCOME_REQUIRED`). Rời `COMPLETED` thì xoá kết quả. Gửi lại đúng trạng thái và kết quả hiện có thì không ghi gì.
- Mỗi lần đổi ghi `appointment.change_status` vào `audit_logs`. `COMPLETED`, `NO_SHOW` ghi thêm một dòng `VIEWING` lên timeline của khách (BĐS của lịch, `metadata {appointmentId, status, outcome}`).
- `GET /api/v1/appointments?status=` lọc một hoặc nhiều trạng thái (phân cách bằng dấu phẩy hoặc lặp tham số).

## Dashboard khách hàng (TASK-085)

`GET /api/v1/customers/dashboard?from&to` (`customer.view`) → số liệu trên khách trong phạm vi xem. Kỳ `[from, to)` mặc định 30 ngày gần nhất, dài nhất 366 ngày; `from` ≥ `to` hoặc kỳ quá dài → 400. Hằng số trong `src/customers/customer-values.ts`.

- Theo hiện trạng: `totalCustomers`, `pipeline` (8 bước), `sources` (mọi nguồn, `null` = chưa ghi nguồn), `followUpNeeded` (khách chưa WON/LOST không có hoạt động nào, tính cả lúc tạo, trong `FOLLOW_UP_AFTER_DAYS` = 14 ngày tới bây giờ).
- Trong kỳ: `newCustomers` (tạo trong kỳ), `activities` (số hoạt động theo loại, theo `occurredAt`), `wonCustomers` / `lostCustomers` (số khách được chuyển sang WON / LOST).

## Luật chấm điểm matching (TASK-086)

`src/matching/match-score.ts`: hàm thuần `scoreMatch(preference, property)` → `{eligible, score, criteria}`, chưa có API (TASK-087..090 dùng lại).

- Khác loại giao dịch (bán/thuê) → `eligible = false`, 0 điểm.
- Trọng số `MATCH_WEIGHTS`: giá 30, khu vực 25, diện tích 15, phòng ngủ 10, loại BĐS 10, đường vào 5, pháp lý 5. Mỗi tiêu chí có mức đạt `ratio` 0..1; `score` = tổng trọng số × mức đạt chia tổng trọng số các tiêu chí khách đã nêu, làm tròn 0..100. Tiêu chí khách không nêu không tính (`SKIP_UNSTATED_CRITERIA`); không nêu gì → 100.
- Giá, diện tích: trong khoảng (gồm biên) → 1; lệch ra ngoài giảm tuyến tính, lệch từ 20% (`RANGE_TOLERANCE`) → 0.
- Khu vực: BĐS nằm trong bất kỳ tỉnh, quận/huyện hoặc phường/xã khách nêu → 1, không thì 0.
- Phòng ngủ: đủ → 1, thiếu đúng 1 → 0.5, thiếu hơn hoặc BĐS chưa ghi → 0.
- Loại BĐS, pháp lý: thuộc danh sách → 1, không thì 0. Đường vào: ô tô > xe máy > đi bộ, đạt yêu cầu → 1 (yêu cầu đi bộ coi như không nêu).
- Hướng nhà chưa có trọng số trong roadmap nên chưa tính.

## Matching BĐS → khách hàng (TASK-087)

Module `src/matching` (`MatchingModule`, dùng `CustomersService` và `PropertiesService`). `MatchingService.customersForProperty(actor, propertyId, {property, customer}, {minScore?, limit?})` → danh sách khách phù hợp (API ở TASK-090).

- BĐS phải trong phạm vi xem của user (không có, công ty khác, ngoài phạm vi → 404). Chỉ xét khách trong phạm vi `customer.view` (`CustomersService.visible`).
- Chỉ xét nhu cầu đang bật, chưa xoá, cùng loại giao dịch với BĐS, của khách chưa xoá và chưa WON/LOST.
- Chấm bằng `scoreMatch` (TASK-086); mỗi khách lấy nhu cầu điểm cao nhất. Giữ khách đạt `minScore` (mặc định `MIN_MATCH_SCORE` = 50), điểm cao trước, cùng điểm thì khách cập nhật gần đây trước; tối đa `limit` (mặc định 20, tối đa 100).
- Mỗi kết quả: `customer {id, fullName, status, agentId}`, `preferenceId`, `score`, `criteria`.

## Matching khách hàng → BĐS (TASK-088)

`MatchingService.propertiesForCustomer(actor, customerId, {property, customer}, {minScore?, limit?})` → danh sách BĐS phù hợp (API ở TASK-090).

- Khách phải trong phạm vi `customer.view` (không có, công ty khác, ngoài phạm vi → 404). Khách không có nhu cầu đang bật → danh sách rỗng.
- Chỉ xét BĐS user xem được (`PropertiesService.visible`), chưa xoá, đang `AVAILABLE` (`MATCHABLE_PROPERTY_STATUS`), cùng loại giao dịch với một nhu cầu đang bật của khách.
- Mỗi BĐS lấy nhu cầu cho điểm cao nhất; lọc, xếp và cắt như TASK-087 (điểm ≥ 50, điểm cao trước, cùng điểm thì BĐS cập nhật gần đây trước, mặc định 20, tối đa 100).
- Mỗi kết quả: `property {id, code, title, propertyType, transactionType, price, area}`, `preferenceId`, `score`, `criteria`.

## Giải thích kết quả matching (TASK-089)

`src/matching/match-explanation.ts`: `explainMatch(score, criteria)` → `{summary, matched, partial, unmatched}`, dựng từ điểm từng tiêu chí (không gọi AI). Mỗi kết quả của `customersForProperty` và `propertiesForCustomer` có thêm `explanation`.

- Tiêu chí mức đạt 1 vào `matched`, giữa 0 và 1 vào `partial`, 0 vào `unmatched`, theo thứ tự trọng số. Tên hiển thị trong `CRITERION_LABELS`.
- Ví dụ `summary`: "92% phù hợp vì đúng khu vực, ngân sách và số phòng ngủ.", "70% phù hợp vì đúng khu vực và diện tích; gần đúng ngân sách; chưa đúng loại BĐS và pháp lý.", khách chưa nêu tiêu chí: "100% phù hợp: khách chưa nêu tiêu chí cụ thể."

## API matching (TASK-090)

`MatchingController` (`src/matching`). Cả hai route nhận `?minScore` (số nguyên 0..100, mặc định 50) và `?limit` (1..100, mặc định 20); sai → 400. Trả mảng kết quả của TASK-087/088 kèm `explanation` (TASK-089), điểm cao trước.

- `GET /api/v1/properties/:id/matching-customers` (`property.view`): BĐS ngoài phạm vi xem → 404. Chỉ gợi ý khách trong phạm vi `customer.view` của user; không có quyền đó → `[]`.
- `GET /api/v1/customers/:id/matching-properties` (`customer.view`): khách ngoài phạm vi xem → 404. Chỉ gợi ý BĐS trong phạm vi `property.view`; không có quyền đó → `[]`.

## Notification service (TASK-092)

`NotificationsService` (`src/notifications`, export từ `NotificationsModule`) là API nội bộ, chưa có route (hộp thư cho người dùng: `/notifications`, TASK-099). `notify({tenantId, userIds, type, title, body, data?})` → `[{id, userId}]`:

- Ghi một dòng `notifications` cho mỗi người nhận; chỉ user ACTIVE, chưa xoá, cùng công ty `tenantId` (id khác bị bỏ qua, id trùng gửi một lần). Gọi sau khi transaction nghiệp vụ đã commit.
- `type` thuộc `NOTIFICATION_TYPES`; tiêu đề 1..255 và nội dung 1..2000 ký tự (đã trim); `data` là object, JSON ≤ 4000 ký tự; tối đa 1000 người nhận. Sai là lỗi lập trình → ném Error, không ghi gì.
- Sau khi ghi, đẩy từng thông báo qua `PushSender`. Đẩy được thì ghi `push_sent_at`; lỗi chỉ ghi log, thông báo vẫn nằm trong hộp thư. Không đặt `FCM_CONFIG` thì dùng `NoopPushSender` (không đẩy); có thì đẩy qua FCM (TASK-093).

## Tích hợp FCM (TASK-093)

Đặt `FCM_CONFIG` (JSON service account Firebase mã hoá base64, xem `docs/environment.md`) thì `PushSender` là `FcmPushSender`; để trống thì thông báo chỉ lưu hộp thư. Cấu hình sai (không phải base64 JSON, thiếu `project_id` / `client_email` / `private_key`) làm backend dừng khi khởi động.

- Gọi thẳng FCM HTTP v1 (`src/notifications/fcm.client.ts`), không dùng SDK `firebase-admin`: ký JWT RS256 bằng khoá service account, đổi lấy access token OAuth2 ở `token_uri` (cache tới 1 phút trước khi hết hạn), rồi `POST /v1/projects/{project_id}/messages:send` cho từng token thiết bị, timeout 10 giây.
- Tin gồm `notification {title, body}` và `data` dạng chuỗi: dữ liệu của thông báo (giá trị khác chuỗi đổi sang JSON, bỏ khoá FCM cấm như `from`, `google*`, `gcm*`) cộng `type` và `notificationId`.
- Token trả 404 `UNREGISTERED` hoặc 400 `INVALID_ARGUMENT` bị xoá khỏi kho token. Gửi được ít nhất một thiết bị → `push_sent_at` được ghi; người nhận chưa có thiết bị → không ghi; mọi lần gửi đều lỗi → ghi log cảnh báo.
- Token thiết bị lấy từ `DeviceTokenStore`, bản lưu bảng `device_tokens` là `DeviceTokensService` (TASK-094).

## Thiết bị nhận thông báo (TASK-094)

Token FCM của thiết bị lưu ở bảng `device_tokens`. Chỉ cần đăng nhập, không cần permission; mỗi người chỉ thấy và gỡ được thiết bị của mình:

- `POST /device-tokens` {token, platform: `ANDROID` | `IOS` | `WEB`} → 201 `{id, platform, lastSeenAt, createdAt}`. App gọi sau khi đăng nhập và mỗi khi FCM cấp token mới. Token đã có thì làm mới `last_seen_at` và chuyển sang người đang đăng nhập (một thiết bị chỉ nhận tin của người đăng nhập gần nhất). Token 1..4096 ký tự, không khoảng trắng.
- `GET /device-tokens` → thiết bị của mình, dùng gần nhất trước; không trả lại token.
- `DELETE /device-tokens/:id` → 204; app gọi trước khi đăng xuất. Thiết bị của người khác hoặc đã gỡ → 404.
- Mỗi người tối đa 10 thiết bị (`MAX_DEVICES_PER_USER`); đăng ký thêm thì thiết bị lâu không dùng nhất bị gỡ.
- FCM chỉ gửi tới token được làm mới trong 270 ngày (`DEVICE_TOKEN_STALE_DAYS`); token FCM báo hỏng bị xoá.

## Thông báo BĐS mới (TASK-095)

Tạo BĐS xong (sau khi commit), `PropertiesService` phát `PropertyEvents.created`; `NewPropertyNotifier` (`src/notifications`) chạy nền, không làm chậm hay làm hỏng `POST /properties`:

- Xét mọi tìm kiếm đã lưu bật `notify`, chưa xoá, của user ACTIVE cùng công ty, trừ người tạo BĐS.
- BĐS phải khớp bộ lọc đã lưu theo quyền xem BĐS hiện tại của người đó, đúng điều kiện của `GET /properties` (`PropertiesService.matchesSearch`). Không có `property.view` thì không nhận. Bộ lọc không còn hợp lệ thì bỏ qua tìm kiếm đó (ghi log cảnh báo).
- Mỗi người nhận một thông báo `NEW_PROPERTY` dù khớp nhiều tìm kiếm: tiêu đề "BĐS mới khớp tìm kiếm đã lưu", nội dung `<mã> · <tiêu đề>. Khớp: "<tên tìm kiếm>", ...`, `data` = `{propertyId, savedSearchIds}`. Các tìm kiếm khớp được ghi `last_notified_at`.
- Chỉ khi tạo BĐS mới; sửa BĐS hoặc mở bán lại không báo.

## Thông báo matching (TASK-096)

Cùng sự kiện tạo BĐS như TASK-095, `MatchingNotifier` (`src/notifications`) chạy nền:

- Xét môi giới ACTIVE đang phụ trách (`customers.agent_id`) khách chưa WON/LOST có nhu cầu đang bật cùng loại giao dịch với BĐS.
- Với mỗi môi giới, ghép bằng `MatchingService.customersForProperty` theo quyền xem BĐS và khách của chính họ (điểm ≥ 50, tối đa 100 khách), rồi chỉ giữ khách họ phụ trách. Không xem được BĐS thì bỏ qua; lỗi với một môi giới chỉ ghi log, vẫn báo người khác.
- Mỗi môi giới nhận một thông báo `MATCHED_PROPERTY`, kể cả người tạo BĐS: tiêu đề "BĐS mới phù hợp với khách của bạn", nội dung `<mã> · <tiêu đề>. Phù hợp: <khách> (<điểm>%), ... và N khách khác` (nêu tên 3 khách điểm cao nhất), `data` = `{propertyId, matchCount, customers: [{customerId, score}]}` (tối đa 20 khách).

## Nhắc lịch hẹn (TASK-097)

`AppointmentReminderJob` (`src/notifications`) chạy mỗi 5 phút:

- Lịch hẹn SCHEDULED, chưa xoá, chưa nhắc, diễn ra trong 60 phút tới (`APPOINTMENT_REMINDER_LEAD_MINUTES`, Huy Lê chọn) → môi giới phụ trách nhận thông báo `VIEWING_REMINDER`: tiêu đề "Sắp tới giờ hẹn dẫn khách", nội dung `14:30 ngày 09/10 · <khách> xem <mã BĐS> <tiêu đề>. Địa điểm: ...` (giờ Việt Nam), `data` = `{appointmentId}`.
- Ghi `reminder_sent_at` bằng một lệnh `UPDATE ... RETURNING` trước khi gửi, nên nhiều instance cùng chạy không nhắc trùng; gửi lỗi thì chỉ ghi log, không thử lại.
- Lịch đã qua giờ mà chưa nhắc (server tắt) thì bỏ qua. Đổi `scheduledAt` qua `PATCH /appointments/:id` thì xoá `reminder_sent_at` để nhắc lại theo giờ mới.

## Nhắc xác minh BĐS (TASK-098)

Khi job xác minh (TASK-062) chuyển BĐS quá hạn sang `VERIFY_REQUIRED`, `PropertiesService` phát `PropertyEvents.verificationExpired` với các BĐS vừa chuyển; `VerifyReminderNotifier` (`src/notifications`) chạy nền:

- Mỗi môi giới phụ trách nhận một thông báo `VERIFY_REQUIRED` gộp các BĐS của mình trong lần chạy đó: tiêu đề "BĐS cần xác minh lại"; một BĐS thì `<mã> <tiêu đề> đã quá hạn xác minh, cần xác minh lại để tiếp tục bán.`, nhiều BĐS thì nêu 3 mã đầu và "và N BĐS khác". `data` = `{count, propertyIds}` (tối đa 50 id).
- BĐS chỉ chuyển trạng thái một lần cho tới khi được xác minh lại, nên mỗi lần quá hạn chỉ nhắc một lần. Môi giới bị khoá hoặc đã xoá thì không nhận.

## Trung tâm thông báo (TASK-099)

Hộp thư của người đang đăng nhập. Chỉ cần đăng nhập, không cần permission; mỗi người chỉ thấy thông báo gửi cho chính mình (của người khác → 404):

- `GET /notifications?unread=true|false&type=A,B&page&pageSize` → mới nhất trước, phân trang như các danh sách khác. Mỗi mục `{id, type, title, body, data, readAt, createdAt}`; `data` cho app mở đúng màn hình (vd `propertyId`, `appointmentId`).
- `GET /notifications/unread-count` → `{count}` cho badge.
- `POST /notifications/:id/read` → thông báo đã đánh dấu đọc; đọc lại giữ thời điểm đọc đầu tiên.
- `POST /notifications/read-all` → `{count}` số thông báo vừa đánh dấu.

## Dashboard quản trị (TASK-102)

`GET /api/v1/reports/dashboard?from&to` (`report.view`) → số liệu tổng và phễu cho web admin. Module `src/reports` chỉ đọc. Kỳ `[from, to)` giống dashboard khách: mặc định 30 ngày gần nhất, dài nhất 366 ngày, sai thì 400.

Mọi số liệu chỉ tính bản ghi chưa xoá của công ty, trong phạm vi `report.view` của người xem (`scope` trong kết quả). Phạm vi xét theo người phụ trách hoặc người tạo, như `src/auth/record-scope.ts`.

- `properties`: `total` hiện có; `new` tạo trong kỳ; `active` đang bán (`AVAILABLE`).
- `customers`: `total` hiện có; `new` (lead mới) tạo trong kỳ.
- `viewings`: lịch hẹn có `scheduled_at` trong kỳ, trừ lịch đã huỷ.
- `deals`: `new` tạo trong kỳ; `won` là giao dịch `WON` có `closed_at` trong kỳ; `revenue` là tổng `deal_price` của các giao dịch `won` đó.
- `agents`: người dùng đang hoạt động trong phạm vi.
- `leadFunnel`: khách hiện có theo 8 trạng thái; `salesFunnel`: giao dịch hiện có theo 5 bước, kèm tổng giá trị.

## Người dùng (TASK-103)

Module `src/users`. Không có API xoá: nhân viên nghỉ thì chuyển `INACTIVE` để giữ lịch sử BĐS, khách và giao dịch họ phụ trách.

- `GET /api/v1/users?q&status&roleId&departmentId&page&pageSize` (`user.view`): danh sách trong phạm vi xem, mới tạo trước. Phạm vi TEAM/DEPARTMENT/COMPANY như `record-scope.ts`, với chính user là "người phụ trách". `q` tìm trong tên, email, SĐT.
- `GET /api/v1/users/:id` (`user.view`): ngoài phạm vi → 404.
- `GET /api/v1/users/options` (`user.manage`): role và phòng ban của công ty cho form.
- `POST /api/v1/users` (`user.manage` phạm vi COMPANY) → 201. Body: `fullName`, `email` và/hoặc `phone`, `password` (mật khẩu ban đầu do admin đặt, Huy Lê chọn 2026-10-09), `departmentId?`, `roleIds` (1–10).
- `PATCH /api/v1/users/:id` (`user.manage`): chỉ sửa trường có gửi. `email`/`phone`/`departmentId` gửi `null` để xoá; `roleIds` thay toàn bộ danh sách role.
- `POST /api/v1/users/:id/status` (`user.manage`) `{ status: ACTIVE|INACTIVE|LOCKED }`. Rời ACTIVE thì thu hồi mọi refresh token; TenantGuard chặn access token ngay ở request kế tiếp.

Quy tắc an toàn (phase0/04-RBAC.md mục 6):

- Ngoài `user.view` → 404; thấy được nhưng ngoài phạm vi `user.manage` → 403.
- Role phải thuộc công ty (sai → 400).
- Không gán được role có quyền mà người gán không có, hoặc có phạm vi rộng hơn của người gán → 403.
- Không tự đổi role hay trạng thái của mình → 422.
- Công ty luôn còn ít nhất một COMPANY_ADMIN đang hoạt động → 422. Các dòng admin được khoá `FOR UPDATE` để hai thao tác đồng thời không cùng gỡ hai admin cuối.
- Email/SĐT trùng (toàn hệ thống) → 409.
- Ghi `audit_logs` cho `user.create`, `user.update` (gồm đổi role) và `user.status`; không bao giờ ghi mật khẩu.
- Đổi role xoá cache quyền của user đó, nên quyền mới có hiệu lực ngay.

## Vai trò (TASK-104)

Module `src/roles`. Mọi API cần `admin.manage`; vai trò và quyền của vai trò chỉ trong công ty của người gọi.

- `GET /api/v1/roles`: danh sách vai trò, kèm số người dùng, số quyền, `isSystem` (vai trò mặc định) và `permissionsLocked`.
- `GET /api/v1/roles/permissions`: danh mục quyền gán được (không gồm quyền `platform.*`).
- `GET /api/v1/roles/:id`: chi tiết kèm `permissions: [{ code, scope }]`.
- `POST /api/v1/roles` → 201. Body: `code` (chữ in hoa, số, `_`; không đổi được), `name`, `description?`, `permissions` (tối đa 100).
- `PATCH /api/v1/roles/:id`: sửa `name`, `description`, và `permissions` (thay toàn bộ danh sách).
- `DELETE /api/v1/roles/:id` → 204, xoá mềm.

Quy tắc:

- Quyền không tồn tại, quyền `platform.*`, quyền lặp, phạm vi sai → 400.
- Không cấp được quyền mà người gọi không có, hoặc phạm vi rộng hơn của người gọi → 403 (dùng chung `auth/permission-grant.ts` với gán role ở TASK-103).
- Mã vai trò trùng trong công ty → 409.
- Quyền của vai trò COMPANY_ADMIN mặc định bị khoá, chỉ đổi được tên và mô tả (Huy Lê chọn 2026-10-09) → 422 nếu gửi `permissions`.
- Không xoá được vai trò mặc định, hay vai trò còn người dùng → 422 (khoá `FOR UPDATE` khi kiểm).
- Đổi quyền hoặc xoá vai trò xoá cache quyền, nên có hiệu lực ngay ở request kế tiếp.
- Ghi `audit_logs` cho `role.create`, `role.update` (gồm danh sách quyền trước/sau) và `role.delete`.

## Công ty và phòng ban (TASK-105)

Module `src/company`. Mọi API cần `admin.manage` và chỉ làm việc với công ty của người gọi (Huy Lê chọn 2026-10-09: trang quản lý công ty của mình; quản lý mọi công ty cấp nền tảng để sau).

- `GET /api/v1/company`: tên, slug, trạng thái, `settings.verifyIntervalDays` (giá trị đang áp dụng, mặc định 30) và số người dùng, phòng ban, team.
- `PATCH /api/v1/company` `{ name?, verifyIntervalDays? (1–365) }`. Chu kỳ ghi vào `companies.settings.verify_interval_days`, giữ nguyên các cài đặt khác. Không đổi được slug hay trạng thái (gửi lên → 400). Ghi `audit_logs` `company.update`.
- `GET /api/v1/departments`: phòng ban kèm trưởng phòng, số người dùng, số team.
- `GET /api/v1/departments/manager-options`: người dùng đang hoạt động, để chọn trưởng phòng.
- `GET /api/v1/departments/:id`, `POST /api/v1/departments` `{ name, managerId? }` → 201, `PATCH /api/v1/departments/:id` (`managerId: null` để bỏ trưởng phòng), `DELETE /api/v1/departments/:id` → 204.

Quy tắc phòng ban:

- Tên trùng trong công ty → 409.
- Trưởng phòng phải là người dùng đang hoạt động của công ty → 400 (trường `managerId`).
- Còn người dùng hoặc team trong phòng ban thì không xoá được → 422 (khoá `FOR UPDATE` khi kiểm). Xoá là xoá mềm; tên dùng lại được.
- Ghi `audit_logs` `department.create`, `department.update`, `department.delete`.

## Team (TASK-106)

Module `src/teams`. Xem cần `team.view`, sửa cần `team.manage`, theo phạm vi:

- OWN, TEAM: team mình làm trưởng nhóm hoặc là thành viên.
- DEPARTMENT: thêm mọi team thuộc phòng ban của mình.
- COMPANY: mọi team của công ty.

API:

- `GET /api/v1/teams?departmentId`: team trong phạm vi xem, kèm phòng ban, trưởng nhóm, số thành viên.
- `GET /api/v1/teams/options` (`team.manage`): phòng ban tạo team được (COMPANY: mọi phòng ban, DEPARTMENT: phòng ban của mình) và người dùng đang hoạt động của các phòng ban đó.
- `GET /api/v1/teams/:id`: kèm `members` và `canManage`. Ngoài phạm vi xem → 404.
- `POST /api/v1/teams` `{ name, departmentId, leaderId?, memberIds? }` → 201.
- `PATCH /api/v1/teams/:id`: chỉ sửa trường có gửi; `leaderId: null` bỏ trưởng nhóm; `memberIds` thay toàn bộ danh sách thành viên. Thấy nhưng ngoài phạm vi `team.manage` → 403.
- `DELETE /api/v1/teams/:id` → 204, xoá mềm. Dòng thành viên được giữ làm lịch sử; mọi truy vấn phạm vi đã bỏ qua team đã xoá.

Quy tắc:

- Trưởng nhóm và thành viên phải thuộc phòng ban của team (Huy Lê chọn 2026-10-09) → 400 (trường `leaderId`, `memberIds`). Đổi phòng ban của team cũng phải thoả quy tắc này.
- Người mới thêm vào team phải đang hoạt động; thành viên cũ đã ngừng hoạt động vẫn giữ được.
- Phòng ban không tồn tại → 400; ngoài phạm vi `team.manage` → 403.
- Tên team trùng trong cùng phòng ban → 409.
- Ghi `audit_logs` `team.create`, `team.update` (gồm danh sách thành viên trước/sau), `team.delete`.

## Danh mục địa giới (TASK-107)

Module `src/locations`, chỉ đọc, mọi người dùng đã đăng nhập đều gọi được (dữ liệu dùng chung, không thuộc công ty nào). Dùng cho ô chọn khu vực khi tạo, sửa BĐS trên admin.

- `GET /api/v1/locations/provinces`: tỉnh/thành đang dùng, theo tên.
- `GET /api/v1/locations/provinces/:id/wards`: phường/xã đang dùng của tỉnh, theo tên. Tỉnh không có hoặc ngừng dùng → 404; id sai → 400.

## Giao dịch (TASK-110)

Module `src/deals` (bảng `deals`, docs/database.md mục 4.7; đọc khách qua `CustomersService`, BĐS qua `PropertiesService`). Quyền `deal.view` / `deal.manage`, phạm vi xét theo môi giới của giao dịch hoặc người tạo. Bước trong `src/deals/deal-values.ts`: `NEGOTIATING`, `DEPOSIT`, `CONTRACT`, `WON`, `LOST`. Hoa hồng (`commissions`) chưa có API.

- `POST /api/v1/deals` (`deal.manage`) `{customerId, propertyId, dealPrice?, depositAmount?, depositAt?, notes?}` → 201. Môi giới là người tạo, bước `NEGOTIATING`. Khách và BĐS phải là khách/BĐS người tạo xem được (không thì 400 `customerId`/`propertyId`). Số tiền là số nguyên đồng, không âm.
- `GET /api/v1/deals?stage&customerId&propertyId&page&pageSize` (`deal.view`) → giao dịch trong phạm vi xem, mới tạo trước; `stage` lọc một hoặc nhiều bước. `GET /:id`: ngoài phạm vi → 404. Mỗi giao dịch kèm `customer {id, fullName}` và `property {id, code, title}`.
- `PATCH /api/v1/deals/:id` (`deal.manage`): đổi `dealPrice`, `depositAmount`, `depositAt`, `notes` (`null` để xoá); không đổi khách, BĐS. Ngoài phạm vi quản lý → 403, `expectedUpdatedAt` lệch → 409; xoá giá chốt của giao dịch `WON` → 422.
- `POST /api/v1/deals/:id/stage` (`deal.manage`) `{stage, expectedUpdatedAt?}` → 200. Chuyển bước tự do (mở lại được giao dịch đã đóng). Sang `WON` cần đã có giá chốt (422), vì doanh thu dashboard (TASK-102) cộng từ giá này. Vào `WON`/`LOST` ghi `closedAt` = lúc chuyển, về bước đang mở thì xoá. Không tự đổi trạng thái BĐS hay khách.
- `DELETE /api/v1/deals/:id` (`deal.manage`) → 204, xoá mềm (không còn tính vào báo cáo). Tạo, sửa, chuyển bước, xoá ghi `audit_logs` (`entity_type = 'deal'`).

## Nhật ký thao tác (TASK-112)

`src/audit/audit-logs.controller.ts`, chỉ đọc bảng `audit_logs` (chỉ thêm, TASK-025). Quyền `audit.view`, mặc định chỉ `COMPANY_ADMIN` và `DIRECTOR` (phạm vi công ty). Phạm vi xét theo người thao tác: OWN là nhật ký của chính mình, TEAM/DEPARTMENT là của người trong team/phòng, COMPANY là cả công ty, gồm cả dòng do hệ thống ghi (`user` null).

- `GET /api/v1/audit-logs?entityType&entityId&userId&action&from&to&page&pageSize` → mới nhất trước. Mỗi dòng: `{id, user {id, fullName} | null, action, entityType, entityId, changes {field: [cũ, mới]}, ipAddress, userAgent, requestId, createdAt}`.
- `entityType` chữ thường (vd `property`), `action` dạng `module.hanh_dong` (vd `deal.change_stage`), `entityId`/`userId` là UUID, `from` (gồm) và `to` (không gồm) là thời điểm ISO 8601; `from` ≥ `to` → 400. Chỉ thấy nhật ký của công ty mình.

## AI gateway (TASK-133)

Module `src/ai` (bảng `ai_requests`, docs/database.md mục 4.11). Mọi lời gọi AI đi Mobile → Backend → `AiGatewayService` → LLM; API key (`AI_API_KEY`, docs/environment.md) chỉ nằm ở backend. Không có API gọi LLM tự do: mỗi tính năng AI (TASK-134+) có route riêng, kiểm quyền của nghiệp vụ đó rồi gọi gateway.

- `AiGatewayService.complete(user, {feature, system?, messages, tools?, forceTool?, maxTokens?})` → `{text, toolCalls [{id, name, input}], stopReason, usage}`. `forceTool` bắt LLM gọi đúng một tool để lấy kết quả có cấu trúc. `maxTokens` mặc định 1024, tối đa 8192. LLM chỉ đề xuất tool + tham số; backend tự chạy tool qua service với quyền + tenant của user.
- Adapter `LlmProvider`; hiện có `AnthropicProvider` gọi thẳng Messages API bằng `fetch` (không SDK), timeout `AI_TIMEOUT_MS`. Thêm nhà cung cấp = thêm adapter và giá trị `AI_PROVIDER`.
- Mỗi người tối đa `AI_USER_DAILY_LIMIT` lượt (mặc định 100) trong 24 giờ gần nhất, tính cả lượt lỗi; hết lượt → 429 `RATE_LIMITED`, không gọi LLM.
- Mỗi lượt ghi một dòng `ai_requests` (user, tenant, tính năng, model, tool LLM đã gọi, số token, thời gian, `requestId`); không lưu nội dung prompt/câu trả lời.
- Lỗi nhà cung cấp không trả nguyên văn cho client: LLM quá tải (429) → 429 `RATE_LIMITED`, lỗi khác (timeout, mạng, 5xx, sai khoá) → 503 `SERVICE_UNAVAILABLE`. Chưa đặt `AI_API_KEY` → 503 "Tính năng AI chưa được bật".
- `GET /api/v1/ai/status` (chỉ cần đăng nhập) → `{enabled, dailyLimit, used, remaining}`; app dựa vào đây để ẩn/hiện tính năng AI. AI tắt thì `dailyLimit`, `remaining` là null.

## Tìm BĐS bằng câu tự nhiên (TASK-134)

`POST /api/v1/ai/property-search` (`property.view`) `{query}` (2–500 ký tự) → `{filters, explanation, unresolved}`. Theo MASTER_PLAN mục 6: AI chỉ đổi câu thành bộ lọc, không truy cập database; app gửi `filters` lên `GET /properties` để lấy kết quả, nên quyền và phạm vi xem giữ nguyên. Mỗi lần gọi tính một lượt AI (TASK-133).

- LLM bắt buộc gọi tool `property_search_filter` (`src/ai/property-search.tool.ts`) với: giá, diện tích, loại BĐS, số phòng ngủ tối thiểu, pháp lý, hướng, đường vào, sắp xếp, từ khoá, tên khu vực, và một câu `explanation` nói lại các điều kiện đã hiểu. Quy tắc hiểu câu nằm trong system prompt cùng file, vd "khoảng 5 tỷ" → 4,5–5,5 tỷ, "ô tô vào được" → `roadAccess=CAR`.
- Khu vực LLM trả bằng tên, backend đổi ra `provinceId`/`wardId`: so không dấu, không phân biệt hoa thường, bỏ tiền tố "Tỉnh", "Thành phố", "TP", "Phường", "Xã", "Đặc khu", "Thị trấn". Phường phải khớp đúng một phường (trong tỉnh đã nêu nếu có). Tên không khớp (vd "Nha Trang" là thành phố cũ, nay là nhiều phường) không được lọc và nằm trong `unresolved`.
- `filters` đã kiểm bằng đúng schema của `GET /properties`. Trường LLM điền sai (giá trị lạ, min > max) bị bỏ, các trường khác giữ nguyên. LLM không gọi tool → 503.

## AI giải thích matching (TASK-135)

`POST /api/v1/customers/:customerId/matching-properties/:propertyId/ai-explanation` (`customer.view`) → `{property {id, code, title}, preferenceId, score, criteria, explanation, ai {summary, strengths, concerns, pitch}}`. Theo MASTER_PLAN mục 8: điểm và tiêu chí vẫn do luật chấm TASK-086 tính (nhu cầu đang bật, cùng loại giao dịch, cho điểm cao nhất); AI chỉ viết lời giải thích. Mỗi lần gọi tính một lượt AI.

- Phạm vi xem như `GET /customers/:id/matching-properties`: khách ngoài phạm vi `customer.view` hoặc BĐS ngoài phạm vi `property.view` → 404, không gọi AI.
- Khách chưa có nhu cầu đang bật cùng loại giao dịch với BĐS → 422 `BUSINESS_RULE_VIOLATION`, không gọi AI.
- LLM chỉ nhận thông số BĐS (mã, tiêu đề, loại, giá, diện tích, phòng, hướng, pháp lý, đường vào, phường/tỉnh), nhu cầu của khách và điểm từng tiêu chí. Không gửi tên, số điện thoại, email, ghi chú của khách, liên hệ chủ nhà, địa chỉ chi tiết hay mô tả BĐS.
- LLM bắt buộc gọi tool `match_explanation` (`src/ai/match-explanation.tool.ts`). Mỗi câu tối đa 500 ký tự, tối đa 4 điểm hợp, 3 điểm lưu ý. Không gọi tool hoặc thiếu `summary` → 503.

## AI viết tin đăng (TASK-136)

`POST /api/v1/properties/:id/ai-listing` (`property.view`) `{style?}` → `{property {id, code}, style, title, description}`. `style` là `PROFESSIONAL` (mặc định, 150–300 từ), `SHORT` (tối đa 60 từ) hoặc `FACEBOOK` (bài Facebook, TASK-137: `title` là dòng mở đầu, `description` là thân bài 80–200 từ, được dùng tối đa 5 emoji, dòng cuối tối đa 5 hashtag; backend bỏ các hashtag thừa) hoặc `ZALO` (tin nhắn Zalo gửi khách, TASK-138: `title` là lời chào, `description` là tin nhắn 40–120 từ xưng "em", tối đa 3 emoji, không hashtag; backend bỏ mọi hashtag) hoặc `TIKTOK` (video 30–60 giây, TASK-139: `title` là caption tối đa 5 hashtag, `description` là kịch bản 4–6 cảnh dạng "Cảnh 1 (0–5 giây): <hình> | Lời thoại: <câu>", không hashtag). `ai_requests.feature` là `listing_writer`, `facebook_post`, `zalo_post` hoặc `tiktok_script`. Theo MASTER_PLAN mục 18: AI chỉ dùng dữ liệu thật, không bịa giá, diện tích, pháp lý, vị trí, tiện ích. Kết quả chỉ là bản nháp để môi giới sao chép, không lưu vào BĐS. Mỗi lần gọi tính một lượt AI.

- BĐS ngoài phạm vi `property.view` → 404, không gọi AI.
- LLM nhận thông số BĐS như TASK-135 (`src/ai/property-facts.ts`) và mô tả môi giới đã nhập (nguồn duy nhất của tiện ích, đặc điểm). Không gửi địa chỉ chi tiết, chủ nhà, môi giới, hoa hồng.
- Số điện thoại Việt Nam (`0…`, `+84…`, có khoảng trắng, chấm, gạch) bị thay bằng "[đã ẩn số điện thoại]" trong mô tả gửi LLM và trong tin trả về, vì tin để đăng công khai.
- LLM bắt buộc gọi tool `property_listing` (`src/ai/listing-writer.tool.ts`). Tiêu đề tối đa 255 ký tự, nội dung tối đa 5000 ký tự (cùng giới hạn của BĐS). Tiêu đề hoặc nội dung trống → 503.

## AI tóm tắt khách (TASK-140)

`POST /api/v1/customers/:id/ai-summary` (`customer.view`) → `{customerId, summary, keyPoints, openQuestions, activityCount}`. Theo MASTER_PLAN mục 20 ("Tóm tắt lịch sử khách này"). Chỉ trả kết quả, không lưu. Mỗi lần gọi tính một lượt AI.

- Khách ngoài phạm vi `customer.view` → 404, không gọi AI.
- LLM nhận bước pipeline, mục đích, thời gian mua, nguồn, ghi chú, lý do mất khách, mọi nhu cầu (kể cả đang tạm dừng, `src/ai/customer-facts.ts`) và tối đa 30 hoạt động gần nhất theo thứ tự thời gian (giờ Việt Nam, loại, nội dung, đổi bước). Không gửi tên, số điện thoại, email của khách hay tên người chăm sóc. Số điện thoại trong ghi chú và nội dung hoạt động bị ẩn (`src/ai/redact.ts`).
- LLM bắt buộc gọi tool `customer_summary` (`src/ai/customer-summary.tool.ts`). Tối đa 5 ý chính, 3 câu nên hỏi thêm, mỗi câu tối đa 500 ký tự. Tóm tắt trống → 503.

## AI gợi ý chăm sóc khách (TASK-141)

`POST /api/v1/ai/follow-ups` (`customer.view`) → `{thresholdDays, items: [{customer {id, fullName, status, agentId}, lastContactAt, daysSinceContact, suggestion {action, reason, message} | null}]}`. Theo MASTER_PLAN mục 20 ("Khách nào cần follow-up hôm nay?").

- Luật chọn khách (`CustomersService.followUps`), cùng luật `followUpNeeded` của dashboard: khách trong phạm vi xem, chưa WON/LOST, không có hoạt động nào (tính cả lúc tạo) trong `FOLLOW_UP_AFTER_DAYS` (14) ngày. Khách ở bước gần chốt hơn đứng trước, cùng bước thì lâu chưa chăm sóc hơn đứng trước. Tối đa 10 khách.
- Không có khách nào thì `items` rỗng, không gọi AI và không tính lượt.
- AI gợi ý một việc cho mỗi khách (`CALL`, `MESSAGE`, `SEND_PROPERTIES`, `SCHEDULE_VIEWING`), lý do và câu mở đầu. LLM nhận khách dưới mã K1, K2…, chỉ có bước, mục đích, thời gian mua, số ngày chưa chăm sóc, số nhu cầu đang bật và hoạt động gần nhất (số điện thoại bị ẩn). Không gửi tên, liên hệ.
- Gợi ý có mã lạ, việc lạ hoặc thiếu câu bị bỏ; khách đó có `suggestion: null`. LLM không trả danh sách → 503.

## Trợ lý bán hàng AI (TASK-142)

`POST /api/v1/deals/:id/ai-assistant` (`deal.view`) → `{dealId, situation, nextSteps, talkingPoints, risks}`. Theo MASTER_PLAN mục 20 ("Gợi ý cách chốt khách"). Chỉ trả gợi ý, không lưu, không đổi bước giao dịch. Mỗi lần gọi tính một lượt AI. Admin web hiện ở thẻ "Trợ lý bán hàng AI" trên trang chi tiết giao dịch khi AI đang bật.

- Giao dịch ngoài phạm vi `deal.view` → 404, không gọi AI.
- LLM nhận bước giao dịch, giá chốt, tiền cọc, ngày cọc, ngày tạo, ghi chú (số điện thoại bị ẩn), thông số BĐS như TASK-136 và, nếu người hỏi xem được khách, bước pipeline, mục đích, thời gian mua, nhu cầu và tối đa 10 hoạt động gần nhất. Người không có `property.view`/`customer.view` với BĐS/khách đó chỉ gửi mã và tiêu đề BĐS, không gửi khách. Không gửi tên, liên hệ khách, chủ nhà, địa chỉ chi tiết.
- LLM bắt buộc gọi tool `sales_assistant` (`src/ai/sales-assistant.tool.ts`). Tối đa 4 việc nên làm, 4 ý nói với khách, 3 rủi ro, mỗi câu tối đa 500 ký tự. Nhận định trống → 503.

## AI Copilot chat (TASK-143)

`POST /api/v1/ai/copilot` `{messages: [{role, content}], context?: {customerId?, propertyId?}}` → `{reply, toolsUsed, properties, customers}`. Theo MASTER_PLAN mục 20: môi giới hỏi bằng câu tự nhiên, LLM gọi tool (function calling) để lấy dữ liệu, không truy cập database.

- Backend không lưu hội thoại: app gửi lại tối đa 20 lượt, bắt đầu và kết thúc bằng câu hỏi của `user`, `user`/`assistant` xen kẽ (sai → 400). Số điện thoại trong câu người dùng gõ bị ẩn trước khi gửi AI.
- Cần `property.view` hoặc `customer.view` (không có → 403). `context` là khách/BĐS đang mở trên app; ngoài phạm vi xem → 404, thiếu quyền xem loại đó → 403. Kiểm trước khi gọi AI.
- Tool (`src/ai/copilot.tools.ts`), mỗi tool chạy qua service layer với quyền, phạm vi xem và tenant của người hỏi; chỉ gửi LLM tool người hỏi có quyền:
  - `search_properties` (`property.view`): cùng bộ lọc với TASK-134, tối đa 5 BĐS kèm trạng thái và số ngày đã đăng.
  - `get_property` (`property.view`): một BĐS theo mã, thêm mô tả (số điện thoại bị ẩn).
  - `current_customer` (`customer.view`, có `context.customerId`): dữ liệu khách như TASK-140.
  - `matching_properties` (`customer.view` + `property.view`, có `context.customerId`): 5 BĐS điểm cao nhất theo luật TASK-086.
  - `follow_up_customers` (`customer.view`): khách cần chăm sóc như TASK-141, LLM chỉ thấy mã K1, K2…; tên trả cho app ở `customers`.
- Không gửi LLM tên, liên hệ khách, chủ nhà, địa chỉ chi tiết. Tool lỗi (mã lạ, tool không có) trả lỗi cho LLM tự trả lời.
- Mỗi lần gọi LLM tính một lượt AI (`feature` `copilot`). LLM được gọi tool tối đa 3 lần, lần thứ 4 bắt buộc trả lời chữ, nên một câu hỏi dùng 1–4 lượt. Câu trả lời trống → 503.
- `properties` là các BĐS tool đã trả (app hiện thẻ bấm vào chi tiết).

## BĐS nghi trùng (TASK-144)

Theo MASTER_PLAN mục 9: chỉ cảnh báo, không chặn đăng, không tự xoá; admin quyết định.

- `POST /api/v1/properties/duplicate-check` (`property.create`, body như `POST /properties`) → `{threshold, matches}`: BĐS sắp đăng có thể trùng BĐS nào. Không tạo gì. App mobile gọi trước khi lưu BĐS mới; có BĐS nghi trùng thì hỏi lại, người dùng vẫn lưu được.
- `GET /api/v1/properties/:id/duplicates` (`property.view`, ngoài phạm vi → 404) → `{threshold, matches}`. Admin web hiện thẻ "Nghi trùng" trên trang chi tiết BĐS.
- `matches[]`: `{code, similarity, reasons, property}`, giống nhất trước, tối đa 5. Người hỏi không xem được BĐS đó (vd BĐS đã ẩn của người khác) thì `property` null, chỉ có mã. Không trả SĐT chủ nhà.
- So trong cả công ty: cùng loại giao dịch, cùng loại BĐS, cùng phường/xã hoặc cách tối đa 300 m (200 BĐS mới nhất). Độ giống (`src/properties/duplicate-score.ts`) là tổng điểm các tiêu chí có dữ liệu ở cả hai BĐS chia tổng trọng số của chúng: phường/xã 10, toạ độ 15 (≤ 30 m / 100 m / 300 m), giá 15 và diện tích 15 (lệch ≤ 2% / 5% / 10%), SĐT chủ nhà 20 (chỉ khi BĐS đã có chủ nhà), địa chỉ 15 và mô tả 10 (độ giống trigram không dấu, dưới 0,4 coi như khác).
- Ngưỡng `DUPLICATE_THRESHOLD` = 70% (Huy Lê chọn ngày 2026-10-10). Ảnh chưa so (PRD: trùng bằng ảnh để sau MVP).

## Thống kê giá thị trường (TASK-145)

`GET /api/v1/reports/market/prices?provinceId&wardId&propertyType&groupBy&months` (`property.view`) → `{period, groupBy, statuses, minSample, overall, groups}`. Code: `src/reports/market-stats.service.ts`. Giao diện làm ở TASK-148.

- Tính BĐS bán trong phạm vi `property.view` của người hỏi, trong công ty của họ, đăng trong `months` tháng gần nhất (1–36, mặc định 12), trạng thái Đang bán, Đang giao dịch, Đã bán (Huy Lê chọn ngày 2026-10-10). Tin ẩn, hết hạn, chờ xác minh không tính.
- `overall` và mỗi nhóm: `count`, `avgPrice`, `medianPrice`, `minPrice`, `maxPrice` (đồng), `avgArea` (m²). Nhóm có dưới `minSample` = 3 tin chỉ có `count`, các số khác null (tránh số liệu lệch và lộ giá một căn).
- `groupBy=ward` (mặc định, `name` là tên phường/xã) hoặc `propertyType` (`name` null). Nhiều tin trước. Tham số sai → 400.

## Giá/m² (TASK-146)

`GET /api/v1/reports/market/price-per-m2?provinceId&wardId&propertyType&groupBy&months` (`property.view`) → `{period, groupBy, statuses, minSample, overall, groups, trend}`. Cùng tập BĐS và tham số với `market/prices` (TASK-145). Giá/m² là cột `price_per_m2` (giá chia diện tích, đồng/m²).

- `overall`, mỗi nhóm và mỗi tháng: `count`, `avgPricePerM2`, `medianPricePerM2`, `minPricePerM2`, `maxPricePerM2`. Dưới 3 tin thì chỉ có `count`.
- `trend`: mọi tháng trong kỳ theo ngày đăng tin, giờ Việt Nam (`YYYY-MM`, cũ trước). Tháng không có tin có `count` 0.

## Thanh khoản BĐS (TASK-147)

`GET /api/v1/reports/market/liquidity?provinceId&wardId&propertyType&groupBy&months` (`property.view`) → `{period, groupBy, minSample, thresholds, overall, groups}`, theo MASTER_PLAN mục 21 (cung, cầu, số ngày bán). Cùng tham số với `market/prices`.

- `supply`: tin bán Đang bán, Đang giao dịch hiện có. `sold`: căn Đã bán mà lần chuyển sang Đã bán gần nhất nằm trong kỳ. Ngày bán lấy từ nhật ký `property.change_status`; BĐS cũ chưa có nhật ký thì lấy lúc sửa gần nhất.
- `sellThroughRate` = sold / (sold + supply), %. `level` (Huy Lê chọn ngày 2026-10-10): `HIGH` từ 30%, `MEDIUM` từ 10%, `LOW` dưới 10%. Dưới 3 tin thì cả hai là null.
- `medianDaysToSell` (từ ngày đăng đến ngày bán) chỉ có khi bán được từ 3 căn. `medianDaysListed` (số ngày tin đang bán đã đăng) chỉ có khi cung từ 3 tin.
- `viewsPerListing`, `viewingsPerListing`: lượt xem và lượt dẫn khách (trừ lịch huỷ) trong kỳ, chia cho số tin (cung + đã bán).
