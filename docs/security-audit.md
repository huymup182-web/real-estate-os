# Kiểm tra bảo mật (TASK-155)

Rà ngày 2026-10-10 theo danh sách MASTER_PLAN mục 29 (Security). Phạm vi gồm backend NestJS, web quản trị Next.js, app Flutter và database. Mỗi mục ghi chỗ kiểm chứng (code, test) và kết luận. Những gì sửa trong task này đánh dấu **Đã sửa**.

## Tổng hợp

| Mục MASTER_PLAN   | Kết luận         | Kiểm chứng                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT               | Đạt              | `src/auth/access-token.service.ts`: HS256 cố định khi ký và khi kiểm, hạn 15 phút. `JWT_SECRET` ≥ 32 ký tự, production không chạy với khoá dev (`src/config/app-config.ts`).                                                                                                             |
| Refresh token     | Đạt              | `src/auth/refresh-token.service.ts`: token ngẫu nhiên, chỉ lưu hash, xoay vòng mỗi lần dùng. Dùng lại token cũ thì thu hồi cả family (TASK-040). Hạn 30 ngày.                                                                                                                            |
| RBAC              | Đạt              | Kiểm theo permission + scope, không theo tên role (`src/auth/permission.guard.ts`). Route không có `@RequirePermission` chỉ là dữ liệu của chính người đăng nhập (thông báo, thiết bị, `/auth/me`, trạng thái AI) hoặc danh mục chung (tỉnh, phường). Copilot kiểm quyền theo từng tool. |
| Tenant isolation  | Đạt              | `TenantRepository` luôn thêm `tenant_id`. Khoá ngoại kép `(tenant_id, id)` và trigger ở database. Mỗi module có test công ty khác → 404.                                                                                                                                                 |
| Input validation  | Đạt              | `ValidationPipe` toàn cục `whitelist` + `forbidNonWhitelisted` (trường lạ → 400). Body JSON tối đa 100 KB (mặc định Express). UUID kiểm bằng `ParseUuidPipe`.                                                                                                                            |
| Rate limiting     | **Đã sửa**       | Trước đây không có giới hạn nào ngoài lượt AI. Xem mục "Lỗi đã sửa".                                                                                                                                                                                                                     |
| Password hashing  | Đạt              | Argon2id (`src/auth/password.ts`), tự băm lại khi tham số cũ. Mật khẩu ≥ 8 ký tự. Đăng nhập sai email cũng chạy verify trên hash giả để thời gian phản hồi không lộ email.                                                                                                               |
| Audit logs        | Đạt              | `audit_logs` chỉ ghi thêm (trigger chặn UPDATE/DELETE/TRUNCATE), ghi thao tác quan trọng (TASK-025, TASK-112).                                                                                                                                                                           |
| API authorization | Đạt              | `JwtAuthGuard` toàn cục: mặc định mọi route cần token. Chỉ 7 route `@Public()`: đăng ký, đăng nhập, refresh, quên/đặt lại mật khẩu, health, xem link chia sẻ (token ngẫu nhiên, chỉ lưu hash, có hạn).                                                                                   |
| File validation   | Đạt              | Upload qua presigned URL. Lúc xác nhận, backend đọc lại object trên storage: kiểu MIME phải đúng kiểu đã khai, kích thước 1 byte–10 MB. Ảnh được `sharp` đọc lại để làm thumbnail. Link đọc có hạn.                                                                                      |
| SQL injection     | Đạt              | Mọi giá trị từ người dùng đi qua tham số (`:name`, `$n`). Đã quét các chuỗi SQL ghép bằng `${…}`: chỉ ghép hằng số trong code (tên cột, múi giờ, điều kiện phạm vi).                                                                                                                     |
| XSS               | Đạt, thêm header | Admin là React, không có `dangerouslySetInnerHTML`. Nội dung AI hiển thị dạng chữ. **Đã thêm** header bảo mật cho admin và API.                                                                                                                                                          |
| CORS              | Đạt              | Backend không bật CORS: trình duyệt ở domain khác không gọi được API. Admin gọi API từ phía server, app mobile không cần CORS. Test kiểm không có `Access-Control-Allow-Origin`.                                                                                                         |
| HTTPS             | Đạt ở mức code   | Cookie phiên admin `httpOnly`, `secure` ở production, `sameSite`. **Đã thêm** HSTS ở production. Chấm dứt TLS ở hạ tầng (TASK-160). App Android không cho HTTP thường (mặc định Android 9+).                                                                                             |
| Secrets via env   | Đạt              | Chỉ commit `.env.example` và `.env.development` (giá trị dev). Không có secret trong code. Token app mobile lưu ở `flutter_secure_storage`.                                                                                                                                              |
| Lỗ hổng thư viện  | Đạt              | `npm audit --omit=dev` ở root, backend, admin, database: 0 lỗ hổng.                                                                                                                                                                                                                      |

## Lỗi đã sửa

### 1. Dò được mã OTP đặt lại mật khẩu (nghiêm trọng)

- **Lỗi:** mỗi mã OTP 6 số cho sai 5 lần. Nhưng `POST /auth/forgot-password` không giới hạn số lần xin mã, và mỗi lần xin cấp mã mới với 5 lượt thử mới. Kẻ tấn công biết email có thể xin mã liên tục rồi thử, đủ lâu thì chiếm được tài khoản. Cùng lỗ hổng cho phép gửi email hàng loạt vào một hộp thư.
- **Sửa:**
  - Quên mật khẩu: tối đa 5 lần mỗi email và 20 lần mỗi IP trong 15 phút.
  - Đặt lại mật khẩu: tối đa 10 lần mỗi email và 30 lần mỗi IP trong 15 phút.
  - Kẻ tấn công còn thử được nhiều nhất 15 mã trong 15 phút trên một triệu khả năng.
  - Email không có tài khoản cũng bị đếm như nhau, nên không lộ email nào có tài khoản.

### 2. Không giới hạn đăng nhập sai (cao)

- **Lỗi:** dò mật khẩu không bị chặn.
- **Sửa:**
  - Sai 10 lần một tài khoản trong 15 phút thì tạm khoá đăng nhập tài khoản đó (cả khi nhập đúng) tới hết cửa sổ.
  - Sai 50 lần từ một IP trong 15 phút thì chặn IP đó.
  - Chỉ đếm lần sai, đăng nhập đúng xoá bộ đếm của tài khoản.
  - Thêm giới hạn đăng ký 20 lần/giờ mỗi IP, refresh 300 lần/5 phút mỗi IP.
  - Quá giới hạn → 429 `RATE_LIMITED`, header `Retry-After`.

Code: `src/common/rate-limit/rate-limiter.ts`, `src/auth/auth-rate-limits.ts`, `src/auth/auth.controller.ts`. Test: `test/security.spec.ts`. Con số là mặc định Claude chọn, đổi trong `auth-rate-limits.ts`.

### 3. IP người gọi sai khi chạy sau proxy (trung bình)

- **Lỗi:** sau load balancer, mọi request có cùng IP của proxy. Giới hạn theo IP sẽ chặn nhầm mọi người, và nhật ký phiên đăng nhập ghi sai IP.
- **Sửa:** biến `TRUST_PROXY_HOPS` (mặc định 0) báo số proxy tin cậy để Express lấy IP thật từ `X-Forwarded-For` (docs/environment.md). Không tin `X-Forwarded-For` khi chưa đặt biến này, để người gọi không giả được IP.

### 4. Thiếu header bảo mật (thấp)

- **Lỗi:** API trả `X-Powered-By: Express`. API và admin không có header chống nhúng trang, chống đoán kiểu nội dung, không có HSTS.
- **Sửa API** (`src/common/security/security-headers.ts`):
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.
  - HSTS ở production. Bỏ `X-Powered-By`.
- **Sửa admin** (`admin/next.config.ts`):
  - CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`.
  - `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  - HSTS ở production.

## Rủi ro còn lại (chưa sửa, đề xuất)

- **Giới hạn số lần gọi đếm trong bộ nhớ từng instance.** Chạy N instance thì giới hạn thực tế gấp N lần, khởi động lại thì mất bộ đếm. Đủ cho một instance (TASK-160). Khi chạy nhiều instance nên chuyển sang Redis hoặc giới hạn ở load balancer.
- **Đăng ký lộ email đã có tài khoản** (409 khi trùng email). Đây là cách hầu hết hệ thống làm để người dùng biết đăng nhập thay vì đăng ký. Đã có giới hạn 20 lần/giờ mỗi IP.
- **CSP của admin chưa giới hạn script.** Next.js cần script inline. Chặn được thì cần nonce cho từng request, làm cùng lúc cấu hình production nếu cần.
- **Giấy tờ BĐS chỉ kiểm kiểu MIME khai báo, không kiểm nội dung file.** File được phục vụ từ domain object storage (khác domain admin, API), tải về dạng đính kèm, nên không chạy được script trong trang của hệ thống.
