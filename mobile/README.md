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

## Chi tiết BĐS (TASK-121)

- Chạm thẻ trong tab "BĐS" mở `/properties/:id` (vẫn trong tab, thanh tab dưới còn), gọi `GET /properties/:id` và
  `GET /properties/:id/images` riêng (lỗi ảnh không chặn phần thông tin).
- Ảnh vuốt ngang có số thứ tự, chạm để xem ảnh gốc toàn màn hình (chụm để phóng to). Chưa có ảnh thì ảnh giữ chỗ.
- Giá gọn và đầy đủ, giá/m², trạng thái, mã, tiêu đề, địa chỉ; thông số (loại, diện tích, phòng, tầng, hướng, đường,
  pháp lý; trường trống thì ẩn), mô tả, chủ nhà, xác minh và lần cập nhật.
- Không được xem liên hệ chủ nhà (`ownerContactVisible = false`) thì không có số nhà, phần chủ nhà ghi rõ lý do.
  BĐS không tồn tại hoặc ngoài phạm vi (404) thì báo "Không tìm thấy BĐS, hoặc bạn không có quyền xem BĐS này.".
- Kéo xuống tải lại; lỗi thì giữ dữ liệu đang có và báo snackbar. Sửa BĐS ở TASK-123, yêu thích ở TASK-125.

## Thêm BĐS (TASK-122)

- Có quyền `property.create` thì tab "BĐS" có nút "Thêm BĐS" → `/properties/new` → `POST /properties`. Người tạo là
  môi giới phụ trách (backend gán). Lưu xong mở chi tiết BĐS vừa tạo, danh sách tải lại.
- Form dùng chung cho sửa (TASK-123): `presentation/property_form.dart` (`PropertyForm`, `PropertyDraft`). Bắt buộc:
  tiêu đề, loại, giá (đồng, ô tự chèn dấu chấm và hiện "= 2,5 tỷ"), diện tích (> 0, 2 số lẻ), tỉnh/thành, phường/xã.
  Tuỳ chọn: số nhà/đường, phòng ngủ, WC, số tầng (≤ 32.767), đường rộng (m), hướng, đường vào, pháp lý, mô tả.
  Ô trống không gửi. API trả lỗi từng trường (`VALIDATION_ERROR`) thì hiện dưới ô đó.
- Đã nhập mà bấm quay lại thì hỏi "Bỏ thay đổi?". Chưa nhập toạ độ, nguồn, hoa hồng (web admin cũng chưa có).

## Sửa BĐS (TASK-123)

- Chi tiết BĐS có nút sửa khi `canEdit` (phạm vi `property.edit`) → `/properties/:id/edit`, dùng lại `PropertyForm`
  điền sẵn giá trị hiện tại → `PATCH /properties/:id` gửi mọi trường (ô trống là `null` để xoá) kèm
  `expectedUpdatedAt`. Lưu xong quay về chi tiết đã tải lại, danh sách cũng tải lại.
- Không xem được địa chỉ chi tiết thì không có ô số nhà và không gửi `streetAddress` (không xoá nhầm).
- Người khác vừa lưu trước (409) thì báo "BĐS vừa được người khác sửa…", không ghi đè.
- Đổi trạng thái, chủ nhà, phân môi giới, xác minh chưa làm trên app.

## Ảnh BĐS (TASK-124)

- Chi tiết BĐS có nút "Quản lý ảnh" khi `canEdit` → `/properties/:id/images`: lưới ảnh, ảnh bìa có nhãn. Chạm ảnh để
  đặt làm ảnh bìa (`POST …/images/:imageId/cover`) hoặc xoá (hỏi lại; `DELETE`, xoá ảnh bìa thì ảnh đầu còn lại
  thành ảnh bìa).
- "Thêm ảnh": chọn nhiều ảnh từ thư viện hoặc chụp (gói `image_picker`, ảnh thu nhỏ còn cạnh dài ≤ 2560px). Tải lần
  lượt 3 bước: `POST …/images/upload-url` → PUT file thẳng lên link storage (Dio riêng, không gửi token) →
  `POST …/images`. Mỗi ảnh hiện tiến độ; lỗi thì chạm để thử lại hoặc bỏ. JPG/PNG/WEBP/HEIC, ≤ 10MB, tối đa 30 ảnh.
- Đang tải mà quay lại thì hỏi "Dừng tải ảnh?". Chưa đổi thứ tự ảnh (API `PUT …/images/order` có sẵn).
- Quyền máy: iOS khai báo `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription` (`ios/Runner/Info.plist`);
  Android không cần khai báo thêm (trình chọn ảnh hệ thống).
- Backend cần cấu hình storage (`STORAGE_*`); chưa cấu hình thì bước xin link báo lỗi.

## BĐS yêu thích (TASK-125)

- Thẻ BĐS và thanh tiêu đề chi tiết có nút tim: bấm là đổi ngay rồi gọi `PUT`/`DELETE /properties/:id/favorite`;
  lỗi thì trả lại như cũ và báo snackbar, đang gửi thì bấm thêm không gửi lại. Trạng thái vừa đổi giữ ở
  `favoriteOverridesProvider` nên danh sách, chi tiết đã tải không cần tải lại.
- Tab "BĐS" có nút tim trên thanh tiêu đề → `/properties/favorites` (`GET /properties/favorites`, mới lưu trước,
  cuộn để tải thêm, kéo để tải lại). Bỏ tim ở đây thì thẻ ẩn ngay, snackbar có "Hoàn tác".

## Danh sách khách hàng (TASK-126)

- Tab "Khách hàng": `GET /customers` (khách trong phạm vi `customer.view`, mới tạo trước), 20 khách mỗi trang, cuộn
  để tải thêm, kéo để tải lại. Thẻ khách: tên, số điện thoại (`+849…` hiện `09xx xxx xxx`), bước pipeline có màu,
  mục đích, thời gian mua, nguồn, ngày tạo.
- Ô tìm theo tên, số điện thoại, email (`q`, tối đa 100 ký tự, chờ ngừng gõ 400ms). Hàng nút lọc theo bước
  (chọn nhiều, gửi `status=A,B`); "Tất cả" bỏ lọc.
- Ô tìm dùng chung `core/widgets/debounced_search_field.dart`; cuối danh sách dùng chung
  `core/widgets/load_more_footer.dart`. Chạm thẻ để xem chi tiết (TASK-127).

## Chi tiết khách hàng (TASK-127)

- Chạm thẻ khách → `/customers/:id` (trong tab "Khách hàng"): `GET /customers/:id`, không xem được thì báo rõ.
  Mục "Thông tin": điện thoại, email, mục đích, thời gian mua, nguồn, môi giới phụ trách (mình thì "(bạn)", người
  khác thì tên nếu có `user.view` qua `GET /users/:id`, không thì "—"), lý do mất khách, ngày tạo, ghi chú.
- "Nhu cầu" (`GET /customers/:id/preferences`) tóm tắt một dòng như web admin, tên tỉnh lấy từ danh mục tỉnh;
  nhu cầu tắt ghi "(tạm dừng)". "Hoạt động" (`GET /customers/:id/activities`) mới nhất trước, "Xem thêm" tải trang
  sau. Hai phần này tải riêng, lỗi thì thử lại riêng. Kéo xuống để tải lại cả màn.
- `core/widgets/detail_section.dart` (`DetailSection`, `InfoRow`) dùng chung với chi tiết BĐS. Ghi hoạt động
  chưa làm trên app.

## Pipeline khách hàng (TASK-128)

- Tab "Khách hàng" có nút "Pipeline" → `/customers/pipeline` (`GET /customers/pipeline`): số khách xem được ở
  từng bước, thanh dài theo bước đông nhất. Chạm một bước → về danh sách chỉ lọc bước đó (hàng nút tự cuộn tới).
- Chi tiết khách có nút "Đổi bước" khi có `customer.edit`: chọn bước mới (chuyển tự do giữa mọi bước, theo luật
  TASK-082); sang "Mất khách" bắt buộc lý do. `POST /customers/:id/status` kèm `expectedUpdatedAt`; người khác vừa
  sửa (409) thì báo và tải lại. Xong thì chi tiết, timeline, danh sách, pipeline đều tải lại. Timeline hiện
  "bước trước → bước sau".

## Lịch hẹn (TASK-129)

- Trang chủ có nút "Lịch hẹn" (thanh tiêu đề) và "Xem lịch" (mục lịch hẹn sắp tới) khi có `appointment.view` →
  `/home/calendar`. Lưới tháng theo giờ Việt Nam (tuần bắt đầu thứ 2), mỗi ngày hiện số lịch; hôm nay viền màu,
  ngày đang chọn tô màu; nút tháng trước/sau và "Hôm nay". Bên dưới là lịch của ngày đang chọn.
- `GET /appointments?from&to` với from/to là 0 giờ (giờ Việt Nam) đầu tháng và đầu tháng sau, tải hết các trang
  (100 dòng/trang), nhóm theo ngày giờ Việt Nam.
- Chạm một lịch → bảng chi tiết. Có `appointment.manage` thì đổi được trạng thái; "Đã xem" (kèm kết quả nếu có,
  không bắt buộc theo TASK-084) và "Khách không đến" chỉ chọn được khi đã tới giờ hẹn.
  `POST /appointments/:id/status` kèm `expectedUpdatedAt`; người khác vừa sửa (409) thì báo và tải lại. Xong thì
  lịch tháng và lịch sắp tới ở trang chủ tải lại.

## Thông báo (TASK-130)

- Tab "Thông báo": hộp thư của người đang đăng nhập (`GET /notifications`, 20/trang, mới nhất trước), cuộn gần
  cuối thì tải thêm, kéo xuống để tải lại; nút "Chưa đọc" lọc `unread=true`. Thông báo chưa đọc có chấm và chữ
  đậm.
- Tab có số chưa đọc (`GET /notifications/unread-count`, lỗi thì ẩn); chuyển sang tab thì tải lại hộp thư và số.
- Chạm thông báo → `POST /notifications/:id/read` (đổi ngay trên màn hình, lỗi thì trả lại) và mở màn hình liên
  quan như web admin: lịch hẹn → lịch, `propertyId` → chi tiết BĐS, `customerId` → chi tiết khách, nhắc xác minh
  nhiều BĐS → danh sách BĐS. Chỉ nhận id dạng UUID.
- "Đánh dấu đã đọc tất cả" → `POST /notifications/read-all`.
- Chưa nhận tin đẩy (FCM) trên điện thoại: cần cấu hình Firebase của dự án (`google-services.json`,
  `GoogleService-Info.plist`) và thư viện `firebase_messaging`, làm khi có cấu hình.

## Tài khoản (TASK-131)

- Tab "Tài khoản": ảnh đại diện (hoặc chữ viết tắt họ tên), tên, công ty, email, số điện thoại, vai trò từ
  `GET /auth/me`; kéo xuống để đọc lại (lỗi thì giữ hồ sơ, báo snackbar). Sửa hồ sơ do quản trị viên làm trên web
  (backend chưa có API tự sửa hồ sơ).
- "Đổi mật khẩu" (`/profile/password`, khi tài khoản có email): "Gửi mã" → `POST /auth/forgot-password` gửi mã 6
  số tới email; nhập mã, mật khẩu mới (≥ 8 ký tự) hai lần → `POST /auth/reset-password`. Máy chủ thu hồi mọi phiên,
  nên app đăng xuất và về màn đăng nhập. Mã sai hoặc hết hạn thì báo lỗi, có "Gửi lại mã".
- Đăng xuất cần xác nhận.

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
