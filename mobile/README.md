# mobile

Ứng dụng di động cho môi giới, viết bằng Flutter (Android/iOS). Chỉ gọi Backend API, không truy cập database trực tiếp.

- Tên app: **Real Estate OS**, mã package `com.realestateos.app` (Android `applicationId`, iOS bundle id).
- Flutter stable 3.47 (Dart 3.13).

## Chạy

```bash
cd mobile
flutter pub get
flutter run                                   # mặc định ENV=local, API http://10.0.2.2:3000 (emulator Android)
flutter run --dart-define=API_BASE_URL=http://localhost:3000   # iOS simulator
flutter run --dart-define=ENV=staging --dart-define=API_BASE_URL=https://api-staging.example.vn
```

Cấu hình chỉ qua `--dart-define`, không có secret trong app:

| Biến           | Mặc định               | Ý nghĩa                                                       |
| -------------- | ---------------------- | ------------------------------------------------------------- |
| `API_BASE_URL` | `http://10.0.2.2:3000` | Gốc backend, app tự thêm `/api/v1`. Ngoài `local` phải https. |
| `ENV`          | `local`                | `local`, `staging` hoặc `production`.                         |

Giá trị sai thì app báo lỗi ngay khi mở. Gọi http tới backend local: Android chỉ cho phép ở bản debug
(`android/app/src/debug/AndroidManifest.xml`), iOS cho phép mạng nội bộ (`NSAllowsLocalNetworking`).

## Kiểm tra

```bash
flutter analyze   # lint theo analysis_options.yaml
flutter test
```

## Kiến trúc (TASK-113)

```text
lib/
├── main.dart               # ProviderScope + App
├── app.dart                # MaterialApp.router, tiếng Việt
├── core/
│   ├── config/             # AppConfig (--dart-define)
│   ├── error/              # ApiException, mã lỗi khớp backend
│   ├── network/            # ApiClient (Dio): gắn token, bóc {data, meta}, đổi lỗi
│   ├── storage/            # TokenStorage (secure storage)
│   ├── router/             # go_router: đường dẫn và khung 5 tab
│   └── providers.dart      # phụ thuộc dùng chung (Riverpod)
└── features/<tên>/
    ├── data/               # gọi ApiClient, đổi JSON ↔ model
    ├── domain/             # model, quy tắc thuần Dart
    └── presentation/       # màn hình, widget, provider của màn hình
```

- State management: Riverpod (`flutter_riverpod`). Phụ thuộc khai báo là provider trong `core/providers.dart`;
  test thay bằng `ProviderScope(overrides: [...])`.
- Gọi API: chỉ qua `ApiClient` (Dio). Mọi lỗi thành `ApiException` có `code` theo mã lỗi backend
  (`VALIDATION_ERROR`, `FORBIDDEN`...) cộng `NETWORK_ERROR` khi mất mạng; `fieldErrors` để hiện lỗi dưới ô nhập.
- Token đăng nhập lưu bằng `flutter_secure_storage` (Keychain / Keystore), không lưu ở chỗ khác.
- Điều hướng: `go_router`, thanh dưới 5 tab (Trang chủ, BĐS, Khách hàng, Thông báo, Tài khoản), mỗi tab giữ lịch sử
  riêng. Các tab đang là màn hình tạm, làm dần ở TASK-117..131.
- Riverpod 3 mặc định tự thử lại provider bị lỗi; provider nào cần người dùng bấm "Thử lại" thì đặt `retry: (_, _) => null`.

## Splash và phiên đăng nhập (TASK-115)

- Mở app vào `/splash` (logo, tên app, vòng chờ) trong lúc kiểm phiên: có token đã lưu thì gọi `GET /auth/me`.
- Router chuyển theo `sessionProvider` (`features/auth/presentation/session_controller.dart`): đã đăng nhập → trang
  chủ; chưa đăng nhập, hoặc token không còn dùng được (401, tài khoản bị khoá 403; token bị xoá) → `/login`.
  Mở thẳng một trang khi chưa đăng nhập cũng về `/login`.
- Mất mạng hoặc máy chủ lỗi: splash hiện lỗi và nút "Thử lại", giữ token.
- `ApiClient` tự làm mới token: access token hết hạn (`TOKEN_EXPIRED`) thì gọi `POST /auth/refresh` một lần (nhiều
  request cùng lúc dùng chung một lần làm mới, vì backend thu hồi phiên nếu refresh song song), lưu cặp token mới
  rồi gọi lại. Refresh token hết hiệu lực thì xoá token và báo `UNAUTHENTICATED`.

## Đăng nhập, đăng xuất (TASK-116)

- `/login`: email hoặc số điện thoại và mật khẩu (`POST /auth/login`). Số điện thoại gõ kiểu `0901 234 567` được đổi
  sang `+84901234567` như backend lưu (`features/auth/domain/login_identifier.dart`). Ô trống, sai dạng báo ngay dưới
  ô; sai mật khẩu, tài khoản bị khoá hiện câu của backend.
- Thành công: lưu token, đọc quyền từ `GET /auth/me`, router chuyển vào trang chủ. Hỗ trợ tự điền mật khẩu
  (`AutofillGroup`), nút hiện/ẩn mật khẩu, nhấn "Xong" trên bàn phím để gửi.
- Đăng xuất ở tab Tài khoản (hỏi lại trước): `POST /auth/logout` rồi xoá token; mất mạng vẫn xoá token trên máy.
- Phiên hết hạn giữa chừng (`ApiClient.sessionExpired`, làm mới token thất bại) thì app tự về màn đăng nhập.
- Chưa có: quên mật khẩu trên app (backend đã có `forgot-password`, `reset-password`).

## Theme (TASK-114)

`lib/core/theme/`, theo bảng token đề xuất ở design system (brand xanh `#1D4ED8`, nền slate, Material 3):

- `AppTheme.light` / `AppTheme.dark`, app đổi theo cài đặt sáng/tối của máy (`ThemeMode.system`).
- Màu theo vai trò: `Theme.of(context).colorScheme` (primary, error, surface, outline...) và `context.appColors`
  (success, warning, info, mutedForeground, border). Không viết mã màu trong widget.
- `AppSpacing` (bội số 4, lề màn hình 16, vùng chạm tối thiểu 48), `AppRadius`, `AppDurations` trong `app_tokens.dart`.
- Cỡ chữ: `bodyLarge` 16 là cỡ thường, `bodyMedium` 14, `titleLarge` 18 đậm vừa, `headlineMedium` 24.
- Nút, ô nhập, thẻ, thanh dưới, snackbar đã có style chung; màn hình chỉ dùng widget Material có sẵn.
- Test kiểm độ tương phản WCAG AA cho mọi cặp chữ/nền ở cả hai theme.
- Font: font hệ thống (Roboto trên Android, SF Pro trên iOS). Font Be Vietnam Pro trong đề xuất design system chưa
  thêm vì cần đóng gói file font.
