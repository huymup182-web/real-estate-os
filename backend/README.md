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
- Test: `test/properties-get.spec.ts` (AGENT, TEAM_LEADER, MANAGER, COLLABORATOR, role tuỳ chỉnh phạm vi OWN, 2 công ty).

## Danh sách BĐS (TASK-051)

`GET /api/v1/properties?page=1&pageSize=20` → `data` (mảng) + `meta` `{ page, pageSize, total, totalPages }`. Cần quyền `property.view`.

- Chỉ gồm BĐS trong phạm vi `property.view` của user (cùng `scopeCondition` với chi tiết), chưa xoá mềm, mới tạo trước.
- Mỗi dòng giống chi tiết nhưng không có `owner`; `streetAddress`, `ownerId` ẩn theo phạm vi `property.view_owner_contact` (`ownerContactVisible`), toạ độ luôn có.
- `pageSize` tối đa 100. Tham số lạ (vd `status`) → 400: lọc, tìm kiếm, sắp xếp khác làm ở Phase 5 (TASK-064..074).
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
- `src/search`: `PropertySearchQueryDto` (bộ lọc dùng chung cho saved search, các bộ lọc khác thêm ở TASK-065..072), `keywordTsQuery()`.
