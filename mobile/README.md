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

## Trang chủ (TASK-117)

- Lời chào theo giờ Việt Nam và tên gọi (chữ cuối của họ tên), tên công ty.
- "30 ngày gần nhất" (`GET /reports/dashboard`, cần `report.view`): BĐS đang bán, khách mới, lịch xem nhà, giao
  dịch thành công, trong phạm vi xem của người dùng.
- "Lịch hẹn sắp tới" (`GET /appointments?from=<bây giờ>&status=SCHEDULED&pageSize=5`, cần `appointment.view`):
  giờ, ngày (Hôm nay / Ngày mai / Thứ…), khách, BĐS, địa điểm.
- Không có quyền thì ẩn phần đó, không gọi API. Mỗi phần lỗi riêng có nút "Thử lại"; kéo xuống để tải lại.
- Ngày giờ, số tiền hiện theo giờ Việt Nam bằng `core/format/vn_format.dart` (UTC+7 cố định, như web admin).
  Giờ hiện tại lấy qua `clockProvider` để test được.

## Danh sách BĐS (TASK-118)

- Tab "BĐS" gọi `GET /properties?page=&pageSize=20` (BĐS trong phạm vi xem, mới tạo trước), hiện tổng số và thẻ BĐS:
  ảnh bìa (ảnh nhỏ), trạng thái, giá gọn ("3,5 tỷ"), tiêu đề, diện tích · phòng ngủ · WC · loại, phường/xã, tỉnh, mã.
- Cuộn gần cuối thì tải trang sau, bỏ dòng trùng giữa các trang. Lỗi tải thêm thì giữ danh sách, hiện "Thử lại" ở
  cuối (không tự gọi lại khi cuộn). Kéo xuống để tải lại; lỗi thì giữ danh sách cũ và báo snackbar.
- `core/network/page.dart`: `Page<T>` = danh sách + `meta` phân trang, dùng chung cho các danh sách sau.
- Lọc, chi tiết làm ở TASK-120, TASK-121.

## Tìm BĐS (TASK-119)

- Ô tìm kiếm trên tab "BĐS" gửi `q` lên `GET /properties`: đúng mã BĐS, hoặc có mọi từ trong tiêu đề, mô tả, địa chỉ
  (có dấu hay không đều được, từ cuối tìm theo tiền tố). Có từ khoá thì khớp nhiều hơn đứng trước.
- Gõ xong 400 ms mới tìm, bấm tìm trên bàn phím thì tìm ngay. Bỏ khoảng trắng thừa, tối đa 200 ký tự; chỉ khác
  khoảng trắng thì không gọi lại. Nút ✕ xoá từ khoá về danh sách đủ. Không có kết quả thì báo kèm từ khoá.
- Điều kiện tìm nằm trong `propertyQueryProvider` (`PropertyQuery`); đổi thì danh sách tải lại từ trang đầu, trang
  cũ về muộn bị bỏ.

## Bộ lọc BĐS (TASK-120)

- Nút "Bộ lọc" cạnh ô tìm kiếm (số trên nút = số nhóm đang dùng) mở bảng lọc: sắp xếp (mặc định: mới nhất, có từ
  khoá thì phù hợp nhất), loại BĐS, giá (tỷ đồng, tối đa 3 chữ số thập phân), diện tích (m², 2 chữ số), tỉnh/thành →
  phường/xã (`GET /locations/...`), phòng ngủ tối thiểu, pháp lý, hướng nhà. Gõ "3,5" hay "3.5" đều được.
- "Áp dụng" gửi tham số lên `GET /properties` (danh sách nối dấu phẩy), giữ từ khoá. Giá/diện tích sai dạng hoặc
  "đến" nhỏ hơn "từ" thì báo lỗi tại ô và cuộn tới đó. Đổi tỉnh thì bỏ phường. "Xoá lọc" trong bảng đưa về mặc định;
  lọc không ra BĐS nào thì danh sách có nút "Xoá bộ lọc". Đóng bảng không áp dụng thì không đổi gì.
- Chưa lọc số WC, độ rộng đường (API có sẵn `bathroomsMin/Max`, `roadWidthMin/Max`).

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
