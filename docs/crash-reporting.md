# Ghi nhận lỗi ứng dụng (TASK-159)

Mục tiêu: lỗi chưa được xử lý ở web quản trị, app di động hay backend đều để lại một dòng log có cấu trúc. Như vậy có thể đếm, nhóm và cảnh báo lỗi trước khi người dùng báo.

Huy Lê chọn "Tự ghi" ngày 2026-10-10: báo cáo lỗi gửi về backend, không dùng dịch vụ ngoài như Sentry. Không thêm thư viện và dữ liệu không ra khỏi hệ thống. Xem và nhóm lỗi bằng công cụ log chọn ở TASK-160. Muốn chuyển sang Sentry sau này thì chỉ thay chỗ gửi báo cáo ở mỗi client.

## Luồng

| Nơi lỗi                                              | Bắt bằng                                                                                          | Đi tới                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Backend: lỗi 500 trong request                       | Bộ lọc lỗi chung (TASK-034)                                                                       | Log `error`, context `ExceptionFilter`, kèm `requestId`                                   |
| Backend: lỗi không ai bắt, tiến trình dừng           | `uncaughtExceptionMonitor` (`src/monitoring/crash-logging.ts`)                                    | Log `fatal`, context `Process`, `origin` là `uncaughtException` hoặc `unhandledRejection` |
| Web quản trị: lỗi khi render ở server, server action | `onRequestError` (`admin/src/instrumentation.ts`)                                                 | `POST /api/v1/crash-reports`                                                              |
| Web quản trị: lỗi trong trình duyệt                  | `error.tsx`, `global-error.tsx` (error boundary), `CrashListener` (`error`, `unhandledrejection`) | Server action → `POST /api/v1/crash-reports`                                              |
| App di động                                          | `FlutterError.onError`, `PlatformDispatcher.onError` (`lib/core/error/crash_reporter.dart`)       | `POST /api/v1/crash-reports`                                                              |

Khi backend dừng vì lỗi, tiến trình vẫn thoát với exit code 1 như mặc định của Node. Hệ thống triển khai khởi động lại, và log `fatal` cho biết lý do.

## `POST /api/v1/crash-reports`

Công khai, vì lỗi có thể xảy ra ở màn đăng nhập. Trả `204`.

| Trường       | Bắt buộc | Giới hạn                                       | Ý nghĩa                                                           |
| ------------ | -------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `platform`   | Có       | `admin` hoặc `mobile`                          | Nơi gửi                                                           |
| `name`       | Có       | 200 ký tự                                      | Loại lỗi, vd `TypeError`, `StateError`                            |
| `message`    | Có       | 2.000 ký tự                                    | Câu lỗi                                                           |
| `stack`      | Không    | 20.000 ký tự                                   | Stack trace                                                       |
| `route`      | Không    | 300 ký tự, bắt đầu bằng `/`, không có `?`, `#` | Mẫu màn hình: `/properties/[id]` (admin), `/properties/:id` (app) |
| `appVersion` | Không    | 50 ký tự, chữ, số, `. + - _`                   | Phiên bản client                                                  |
| `digest`     | Không    | 100 ký tự                                      | Mã lỗi Next.js, trùng với dòng log ở server admin                 |
| `fatal`      | Không    | boolean                                        | Cả trang hỏng (lỗi ở layout gốc của admin)                        |

- Có access token hợp lệ thì log kèm `tenantId`, `userId`. Token hết hạn hoặc sai thì vẫn nhận báo cáo, coi như chưa đăng nhập, không trả 401.
- Giới hạn (mặc định Claude chọn): 30 báo cáo mỗi 5 phút cho mỗi người dùng, 60 báo cáo mỗi 5 phút cho mỗi IP khi chưa đăng nhập. Quá giới hạn thì `429`. Admin gửi qua server của nó nên mọi người dùng admin có chung IP; vì vậy khi đã đăng nhập, giới hạn tính theo người dùng.
- Backend không lưu database. Mỗi báo cáo là một dòng log `error`, context `CrashReport`, có các trường `platform`, `fingerprint`, `errorName`, `errorMessage`, `errorStack`, `route`, `appVersion`, `digest`, `fatal`, `requestId`. Đồng thời tăng `crash_reports_total{platform}` trong `/metrics` ([monitoring.md](monitoring.md)).
- `fingerprint` là mã nhóm lỗi, gồm 16 ký tự hex: SHA-256 của nền tảng, loại lỗi và 3 frame đầu của stack (đã bỏ số dòng, số cột). Không có stack thì dùng câu lỗi đã bỏ số. Cùng lỗi ở cùng chỗ trong code thì cùng mã. Đếm theo `fingerprint` để biết lỗi nào xảy ra nhiều nhất.

## Dữ liệu cá nhân

- Client chỉ gửi thông tin kỹ thuật, không gửi dữ liệu form hay nội dung người dùng nhập.
- `route` là mẫu route: admin bỏ query, hash và đổi id thành `[id]`; app dùng mẫu route của GoRouter.
- Câu lỗi do code tạo ra nên hiếm khi chứa dữ liệu cá nhân. Log vẫn che các trường nhạy cảm như ở mọi log khác (`password`, `token`…, TASK-034).
- Không ghi IP vào log báo cáo; IP chỉ dùng để giới hạn số lần gửi.

## Client

- Mỗi lỗi (loại + câu lỗi) chỉ gửi một lần, tối đa 10 lỗi mỗi lần mở trang hoặc mở app. Một lỗi lặp lại khi vẽ màn hình không gửi liên tục.
- Gửi hỏng (mất mạng, backend lỗi, 429) thì bỏ qua. Báo cáo lỗi không được gây thêm lỗi.
- Web quản trị: màn hình lỗi "Có lỗi xảy ra" kèm `Mã lỗi` (digest) và nút "Thử lại", không hiện chi tiết lỗi. Phiên bản lấy từ biến `APP_VERSION` của server admin.
- App di động: lỗi `silent` của Flutter (vd ảnh không tải được) không gửi. Phiên bản truyền lúc build bằng `--dart-define=APP_VERSION=1.0.0+1` (mặc định `dev`). Bản debug vẫn in lỗi ra console.

## Xem lỗi

- Lỗi mới: lọc log `"context":"CrashReport"`, nhóm theo `fingerprint`, sắp theo số lần.
- Một người dùng báo lỗi: lọc theo `userId`, hoặc theo `digest` hiện trên màn hình lỗi của admin.
- Backend dừng: lọc `"level":"fatal"`.
- Cảnh báo "Lỗi ứng dụng tăng" dùng `crash_reports_total` ([monitoring.md](monitoring.md)).

## Giới hạn đã biết

- Lỗi xảy ra trước khi trang admin chạy xong JavaScript (hydrate) không được bắt ở trình duyệt.
- Stack của admin là code đã nén (minify). Đọc stack cần source map của đúng bản build; mặc định Next.js không công khai source map ở production. Nếu cần, giữ source map lúc build (TASK-160).
- App di động: lỗi native (crash của Android/iOS ngoài Dart) không bắt được nếu không có SDK native. Xem trong Google Play Console và App Store Connect.

## Code và test

- Backend: `src/monitoring/crash-report.dto.ts`, `crash-report.ts` (mã nhóm, giới hạn), `crash-reports.controller.ts`, `crash-logging.ts`. Test `test/crash-reports.spec.ts`:
  - Mã nhóm ổn định khi đổi số dòng hay câu lỗi.
  - Ghi log, metrics, gắn người dùng khi có token.
  - Kiểm dữ liệu (400) và giới hạn (429).
  - Tiến trình con dừng vì exception và vì promise reject, kiểm log `fatal` và exit code 1.
- Admin: `src/lib/crash-report.ts`, `src/app/crash-actions.ts`, `error.tsx`, `global-error.tsx`, `crash-listener.tsx`, `src/instrumentation.ts`. Test `src/lib/crash-report.test.ts`, `src/instrumentation.test.ts`.
- Mobile: `lib/core/error/crash_reporter.dart`, `lib/main.dart`. Test `test/core/error/crash_reporter_test.dart`.
