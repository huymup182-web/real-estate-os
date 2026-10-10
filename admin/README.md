# admin

Web quản trị viết bằng Next.js 16 (App Router, React 19, TypeScript strict). Chỉ gọi Backend API, không truy cập database. Khởi tạo ở **TASK-100**; đăng nhập và các trang quản lý làm ở TASK-101..112.

## Chạy

```bash
cd admin
npm install
npm run dev        # http://localhost:3001
```

Trong Docker (`docker compose up`), container `admin` tự `npm install` lần đầu rồi chạy `npm run dev` ở cổng `3001`.

## Đăng nhập (TASK-101)

- Mọi trang trừ `/login` cần đăng nhập. `src/proxy.ts` chuyển người chưa đăng nhập tới `/login?next=<trang đang mở>`.
- Form đăng nhập là Server Action: phía server của admin gọi `POST /api/v1/auth/login`, rồi lưu token vào hai cookie HttpOnly. JavaScript trên trình duyệt không đọc được token.
  - `reos_access`: access token, SameSite=Lax, hết hạn sớm hơn token 30 giây.
  - `reos_refresh`: refresh token, SameSite=Strict, 30 ngày.
  - Cả hai bật `Secure` khi `NODE_ENV=production`.
- Hết access token mà còn refresh token: proxy gọi `POST /auth/refresh` và đặt cặp cookie mới. Các request đến cùng lúc với cùng refresh token dùng chung một lần gọi, vì backend coi việc dùng lại refresh token cũ là bị lộ và thu hồi cả phiên.
- Refresh bị từ chối: xoá cookie và về `/login`. Backend không trả lời được: giữ phiên, trang tự báo lỗi kết nối.
- Đăng xuất gọi `POST /auth/logout` rồi xoá cookie.
- Mọi tài khoản đang hoạt động đều đăng nhập được; menu sẽ ẩn/hiện theo permission. Kiểm quyền thật vẫn ở backend.

## Dashboard (TASK-102)

Trang chủ `/` là dashboard tổng quan, lấy số liệu từ `GET /api/v1/reports/dashboard` theo phạm vi `report.view` của người xem.

- Kỳ chọn qua `?days=7|30|90`, mặc định 30.
- Có 10 ô số liệu, phễu khách hàng và phễu giao dịch (thanh CSS, không dùng thư viện biểu đồ).
- Người không có `report.view` thấy câu báo chưa có quyền.

## Người dùng (TASK-103)

- Các trang sau đăng nhập nằm trong route group `src/app/(app)/`, dùng chung layout: tên công ty, người dùng, menu theo permission (`src/lib/auth/permissions.ts`) và nút đăng xuất.
- `/users` là danh sách có tìm kiếm, lọc theo trạng thái, vai trò, phòng ban và phân trang. Menu chỉ hiện mục này khi có `user.view`.
- `/users/new` tạo người dùng; admin đặt mật khẩu ban đầu.
- `/users/[id]` sửa thông tin, phòng ban, vai trò và đổi trạng thái (kích hoạt, ngừng hoạt động, khoá). Người không có `user.manage` chỉ xem.
- Thao tác ghi là Server Action (`users/actions.ts`). Lỗi theo trường từ backend (`error.details`) hiện ngay dưới ô nhập.

## Vai trò (TASK-104)

- Menu "Vai trò" hiện khi có `admin.manage`.
- `/roles` liệt kê vai trò với số người dùng và số quyền; vai trò mặc định có nhãn "Mặc định".
- `/roles/new` và `/roles/[id]` dùng chung form: tên, mô tả và bảng quyền gom theo module, mỗi quyền chọn "Không có" hoặc một phạm vi (của mình, nhóm, phòng ban, toàn công ty).
- Quyền của vai trò quản trị công ty bị khoá, form chỉ cho đổi tên và mô tả.
- Vai trò tự tạo xoá được khi không còn người dùng; backend báo lỗi nếu còn.

## Công ty (TASK-105)

- Menu "Công ty" hiện khi có `admin.manage`.
- `/company` sửa tên công ty và chu kỳ xác minh lại BĐS (1–365 ngày), xem số người dùng, phòng ban, team, và liệt kê phòng ban.
- `/company/departments/new` và `/company/departments/[id]` tạo, sửa phòng ban (tên, trưởng phòng) và xoá phòng ban trống.
- Nút xoá có hỏi xác nhận dùng chung ở `src/app/(app)/delete-button.tsx`.

## Team (TASK-106)

- Menu "Team" hiện khi có `team.view`; nút "Thêm team" khi có `team.manage`.
- `/teams` liệt kê team trong phạm vi xem.
- `/teams/new` và `/teams/[id]` tạo, sửa team: tên, phòng ban, trưởng nhóm, thành viên. Trưởng nhóm và thành viên chỉ chọn trong phòng ban đang chọn; đổi phòng ban thì danh sách đổi theo.
- Người không quản lý được team đó chỉ xem trưởng nhóm và thành viên.

## Bất động sản (TASK-107)

- Menu "Bất động sản" hiện khi có `property.view`.
- `/properties` liệt kê BĐS trong phạm vi xem: tìm theo mã, tiêu đề, mô tả; lọc loại, tỉnh/thành; sắp xếp theo mới nhất, giá, diện tích; phân trang.
- `/properties/[id]` hiện thông tin, ảnh, khu vực, môi giới phụ trách và chủ nhà (khi được xem liên hệ chủ nhà). Có thao tác đổi trạng thái, xác minh, giao cho môi giới khác và xoá, mỗi nút chỉ hiện khi có quyền tương ứng.
- `/properties/new` và `/properties/[id]/edit` dùng chung form; đổi tỉnh/thành thì tải lại phường/xã. Người không xem được địa chỉ chi tiết thì không thấy ô này và giá trị cũ được giữ.
- Sửa và các thao tác gửi kèm `expectedUpdatedAt`: ai khác đã sửa BĐS trước thì form báo tải lại trang thay vì ghi đè.
- Chưa có trên admin: lọc theo trạng thái, quản lý ảnh, giấy tờ và chủ nhà (vẫn làm trên app).

## Khách hàng (TASK-108)

- Menu "Khách hàng" hiện khi có `customer.view`; nút "Thêm khách hàng" khi có `customer.create`.
- `/customers` hiện số khách ở từng bước pipeline (bấm để lọc), tìm theo tên, số điện thoại (gõ `0901 234 567` hay `+84901234567` đều được), email; lọc theo bước; phân trang.
- `/customers/[id]` hiện thông tin, nhu cầu, timeline hoạt động. Có thao tác chuyển bước (sang "Mất khách" bắt buộc lý do), giao cho môi giới khác, thêm ghi chú và xoá, mỗi nút chỉ hiện khi có quyền tương ứng.
- `/customers/new` và `/customers/[id]/edit` dùng chung form; số điện thoại `0xxx` được đổi sang `+84xxx` trước khi gửi.
- Sửa và các thao tác gửi kèm `expectedUpdatedAt`: ai khác đã sửa khách trước thì form báo tải lại trang.
- Chưa có trên admin: sửa nhu cầu và ghi các loại hoạt động khác ngoài ghi chú (vẫn làm trên app).
- Trang khách có link xem lịch hẹn của khách và đặt lịch xem (khi có quyền lịch hẹn).

## Lịch hẹn (TASK-109)

- Menu "Lịch hẹn" hiện khi có `appointment.view`; đặt, sửa, đổi trạng thái, xoá khi có `appointment.manage`.
- `/appointments` liệt kê lịch hẹn trong phạm vi xem, giờ hẹn sớm trước. Mở lần đầu thì xem từ hôm nay; lọc theo khoảng ngày (giờ Việt Nam, gồm cả ngày cuối), trạng thái và khách (`?customerId=`, mở từ trang khách).
- `/appointments/new` chọn khách, BĐS (100 mới nhất trong phạm vi xem), ngày giờ, thời lượng, điểm hẹn, ghi chú. Mở từ trang khách thì chọn sẵn khách đó.
- `/appointments/[id]` hiện thông tin và đổi trạng thái: chọn "Đã xem" thì ghi kèm kết quả buổi xem (không bắt buộc). "Đã xem" và "Khách không đến" chỉ chọn được khi đã tới giờ hẹn (backend báo lỗi cạnh nút).
- `/appointments/[id]/edit` sửa BĐS, giờ, thời lượng, điểm hẹn, ghi chú; không đổi khách. Giờ hẹn không đổi thì gửi lại đúng mốc cũ.
- Chưa có trên admin: xem lịch dạng lịch tháng/tuần, tìm khách và BĐS ngoài 100 mục mới nhất khi đặt lịch.

## Giao dịch (TASK-110)

- Menu "Giao dịch" hiện khi có `deal.view`; tạo, sửa, chuyển bước, xoá khi có `deal.manage`.
- `/deals` liệt kê giao dịch trong phạm vi xem, mới tạo trước; lọc theo bước và khách (`?customerId=`, mở từ trang khách).
- `/deals/new` chọn khách, BĐS (100 mới nhất trong phạm vi xem), giá chốt, tiền cọc (gõ `3.500.000.000` hay `3500000000` đều được), ngày cọc, ghi chú. Mở từ trang khách thì chọn sẵn khách đó.
- `/deals/[id]` hiện thông tin và chuyển bước; sang "Thành công" cần có giá chốt (backend báo lỗi cạnh nút). `/deals/[id]/edit` sửa giá, cọc, ghi chú; không đổi khách, BĐS.
- Chưa có trên admin: hoa hồng, đổi môi giới của giao dịch.

## Thông báo (TASK-111)

- Menu "Thông báo" hiện với mọi người dùng, kèm số chưa đọc (lấy từ `GET /notifications/unread-count`, làm mới sau mỗi thao tác trên trang thông báo).
- `/notifications` liệt kê thông báo của chính mình, mới nhất trước; lọc chưa đọc và theo loại; phân trang.
- "Mở" đánh dấu đã đọc rồi chuyển tới trang liên quan (lịch hẹn, BĐS, khách; nhắc xác minh nhiều BĐS thì mở danh sách BĐS). Link lấy từ `data` của thông báo, id phải là UUID nên luôn là đường dẫn nội bộ. Thông báo không có trang liên quan thì có nút "Đã đọc".
- "Đánh dấu đã đọc tất cả" khi còn thông báo chưa đọc.
- Phần "Nhận tin BĐS mới" (khi có `property.view`): tìm kiếm đã lưu của mình, bật/tắt nhận tin và xoá. Tạo, sửa bộ lọc vẫn làm trên app.
- Chưa có trên admin: gửi thông báo cho người khác (backend chưa có API gửi tay).

## Nhật ký thao tác (TASK-112)

- Menu "Nhật ký" hiện khi có `audit.view` (mặc định quản trị công ty và giám đốc).
- `/audit-logs` liệt kê nhật ký mới nhất trước: thời gian (giờ Việt Nam) và IP, người thao tác ("Hệ thống" khi do job nền), thao tác, đối tượng (link tới trang của nó), thay đổi dạng `trường: cũ → mới`.
- Lọc theo loại đối tượng, mã thao tác, khoảng ngày (gồm cả ngày cuối). Bấm tên người để xem thao tác của người đó; bấm "Lịch sử" để xem mọi thay đổi của một đối tượng.

## Cấu hình

| Biến               | Mặc định                | Ý nghĩa                                                                         |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------- |
| `API_INTERNAL_URL` | `http://localhost:3000` | Gốc backend khi admin gọi từ phía server; trong Docker là `http://backend:3000` |
| `APP_VERSION`      | (trống)                 | Phiên bản gửi kèm báo cáo lỗi (TASK-159)                                        |

Admin không giữ secret nào (không đọc `JWT_SECRET`, `STORAGE_*`, `FCM_CONFIG`, `AI_API_KEY`).

## Lệnh

| Lệnh                | Việc                                                 |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Chạy dev, cổng 3001                                  |
| `npm run build`     | Build production (`.next/`)                          |
| `npm start`         | Chạy bản build, cổng 3001                            |
| `npm run typecheck` | Sinh type route (`next typegen`) rồi `tsc --noEmit`  |
| `npm test`          | Test đơn vị trong `src/**/*.test.ts` (`node --test`) |

Lint và format dùng cấu hình chung ở thư mục gốc (`npm run check`, đã gồm typecheck của admin).

## Cấu trúc

```text
src/
├── app/         # App Router: layout.tsx, page.tsx, login/, auth-actions.ts (Server Action đăng nhập/đăng xuất)
├── lib/         # backend.ts (gọi Backend API), auth/ (cookie phiên, đường dẫn, gọi API auth)
└── proxy.ts     # Chặn trang khi chưa đăng nhập, tự làm mới phiên
```

## Thị trường (TASK-148)

Trang `/market` (menu "Thị trường", cần `property.view`) gom ba API thị trường của backend (TASK-145–147): giá giữa, giá/m² giữa và xu hướng theo tháng, cung, số căn đã bán, tỷ lệ bán kèm mức thanh khoản, và bảng xếp hạng theo phường/xã hoặc loại BĐS. Lọc theo tỉnh/thành, loại BĐS, cách chia nhóm và kỳ 3, 6, 12 hoặc 24 tháng (`?provinceId&propertyType&groupBy&months`). Code: `src/lib/market.ts`, `src/app/(app)/market/page.tsx`.

## Xếp hạng (TASK-151)

Trang `/leaderboard` (menu "Xếp hạng", cần `report.view`) hiển thị bảng xếp hạng môi giới trong phạm vi xem. Có bốn bảng: Top môi giới (theo điểm), Top doanh số, Top tin đăng, Top giao dịch (`?by=points|revenue|listings|deals`). Kỳ 7, 30 hoặc 90 ngày (`?days=`). Mỗi dòng có điểm, tin đăng, chăm sóc, dẫn khách, giao dịch chốt và doanh số. Bằng chỉ số thì cùng hạng. Code: `src/lib/leaderboard.ts`, `src/app/(app)/leaderboard/page.tsx`.

## Phân tích (TASK-152, TASK-153)

Trang `/analytics` (menu "Phân tích", cần `report.view`) gọi `GET /reports/sales` và hiển thị phân tích doanh số trong phạm vi xem. Gồm doanh số so với kỳ trước, số giao dịch chốt, giá trị trung bình, tỷ lệ thắng, số ngày để chốt, giá trị giao dịch đang mở, doanh số theo tháng, giao dịch đang mở theo bước, theo loại BĐS và theo phường/xã. Kỳ 3, 6 hoặc 12 tháng (`?months=`, mặc định 6). Code: `src/lib/analytics.ts`, `src/app/(app)/analytics/page.tsx`.

Tab "Chuyển đổi" (TASK-153, `?tab=conversion`) gọi `GET /reports/conversion`: phễu khách tạo trong kỳ (lead, đã liên hệ, đã xem nhà, đàm phán, chốt) kèm tỷ lệ so với lead và so với bước trước, số khách thất bại, số ngày để liên hệ và để chốt, bảng theo nguồn khách và theo người phụ trách.

## Ghi nhận lỗi (TASK-159)

Lỗi trong trình duyệt (error boundary `error.tsx`, `global-error.tsx`, `CrashListener` bắt lỗi ngoài React) đi qua server action `reportCrashAction`. Lỗi ở server admin đi qua `onRequestError` trong `src/instrumentation.ts`. Cả hai gửi `POST /crash-reports` về backend. Trang lỗi hiện "Có lỗi xảy ra", mã lỗi và nút thử lại. Chi tiết: [docs/crash-reporting.md](../docs/crash-reporting.md).
