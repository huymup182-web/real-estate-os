# UI patterns

Mỗi pattern ghi: dùng khi nào, ráp từ component nào (web / Flutter), hành vi bắt buộc. Tên component khớp với [component-inventory.md](component-inventory.md).

## Khung ứng dụng

### Admin web: App shell

```text
┌──────────┬──────────────────────────────────────────────┐
│ Sidebar  │ Header: Breadcrumbs · Search (⌘K) · Notif · User │
│ (256px,  ├──────────────────────────────────────────────┤
│ thu gọn  │ PageHeader: tiêu đề · mô tả · hành động chính   │
│ 64px)    │ Nội dung (max 1280, gutter 16/24/32)            │
└──────────┴──────────────────────────────────────────────┘
```

- Nguồn: shadcn `sidebar` (block `sidebar-07` hoặc tương đương: thu gọn thành icon), `breadcrumb`, `command` cho tìm nhanh, `dropdown-menu` cho user menu.
- Dưới `lg`: sidebar thành drawer (`Sheet`), mở bằng nút menu ở header.
- Menu theo module §25 của master plan; mục hiện ra theo quyền của user (quyền vẫn kiểm tra ở backend, UI chỉ ẩn).

### Mobile: điều hướng

- `NavigationBar` (M3) 5 tab cố định theo §24: Trang chủ · BĐS · Khách hàng · Thông báo · Cá nhân. Badge số trên tab Thông báo.
- Mỗi tab giữ stack riêng (state không mất khi đổi tab).
- Hành động chính của màn hình: FAB (ví dụ "Thêm BĐS"), không đặt trên AppBar.
- Màn ≥ 600 (tablet): `NavigationRail` thay `NavigationBar`.

## CRUD

Một module CRUD (Users, Properties, Customers...) luôn gồm:

| Màn                       | Web                                                            | Flutter                                                                      |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Danh sách                 | `PageHeader` + `FilterBar` + `DataTable` + `Pagination`        | `SearchAnchor` + `FilterChip` row + `ListView` card + phân trang cuộn vô hạn |
| Chi tiết                  | Trang riêng `/x/[id]`, `Tabs` cho các phần                     | Màn riêng, `SliverAppBar` + section                                          |
| Tạo / sửa                 | Form ngắn (≤ 6 field): `Dialog`/`Sheet`. Form dài: trang riêng | Màn riêng, nút lưu cố định cuối màn                                          |
| Xoá / hành động nguy hiểm | `ConfirmDialog` (shadcn `alert-dialog`), nút `destructive`     | `AlertDialog`                                                                |

Hành vi bắt buộc:

- Sau tạo/sửa/xoá: toast kết quả (`sonner` / `SnackBar`), cập nhật danh sách không reload trang.
- Nút submit disable + spinner khi đang gửi; không cho gửi hai lần.
- Lỗi validation từ backend (`{success:false, message, errors}`) hiển thị đúng field.
- Rời form có thay đổi chưa lưu: hỏi xác nhận.

## Bảng dữ liệu (admin)

- Nguồn: shadcn `table` + TanStack Table (mẫu "Data Table" của shadcn), **phân trang, sort, filter ở server** (dữ liệu theo tenant, có thể lớn).
- Cột: checkbox chọn (khi có bulk action) · cột chính (tên/mã, là link tới chi tiết) · các cột dữ liệu · trạng thái (`StatusBadge`) · menu hành động (`dropdown-menu`, icon `MoreHorizontal`).
- Số, tiền, diện tích căn phải, `tabular-nums`. Text dài cắt bằng `truncate` + tooltip.
- Header dính khi cuộn; hàng cao 48px; hover `bg-muted/50`.
- Mobile web (< md): bảng chuyển thành danh sách card, không cuộn ngang toàn trang.
- Trạng thái: loading = skeleton hàng, empty = `EmptyState` trong khung bảng, error = `ErrorState` có nút thử lại.
- Tham số filter/sort/trang nằm trên URL (`?page=2&status=AVAILABLE`) để chia sẻ link và quay lại đúng chỗ.

## Search & filter

- Ô tìm kiếm debounce 300ms, có nút xoá, phím tắt `/` hoặc `⌘K` (admin).
- Filter nhanh hiển thị trực tiếp (chip / select); filter nâng cao trong `Sheet` (web) hoặc bottom sheet (mobile).
- Luôn hiện filter đang áp dụng dạng chip có nút ×, và nút "Xoá bộ lọc".
- Hiện số kết quả ("128 BĐS").
- Filter BĐS chuẩn: loại BĐS, khoảng giá, khoảng diện tích, tỉnh/thành, phường/xã, số phòng ngủ, pháp lý, trạng thái.

## Form

- Nguồn web: shadcn `form` (react-hook-form + zod), `input`, `select`, `combobox`, `textarea`, `checkbox`, `radio-group`, `switch`, `date-picker`. Flutter: `Form` + `TextFormField`, `DropdownMenu`, `SegmentedButton`, `showDatePicker`.
- Bố cục một cột trên mobile; desktop tối đa 2 cột cho field ngắn. Nhóm field bằng `FormSection` có tiêu đề.
- Label luôn hiện (không dùng placeholder thay label). Field bắt buộc đánh dấu `*`, field tuỳ chọn ghi "(không bắt buộc)" khi đa số là bắt buộc.
- Validate khi blur và khi submit; lỗi ngay dưới field, chữ `destructive` + icon.
- Validation phía client chỉ để trải nghiệm tốt; backend vẫn là nơi validate thật.
- Input chuyên dụng: `PriceInput` (VND, tự format dấu chấm hàng nghìn), `AreaInput` (m²), `PhoneInput` (+84), `LocationSelect` (tỉnh → phường/xã), `ImageUploader`.

## Trạng thái (bắt buộc cho mọi màn có dữ liệu)

| Trạng thái       | Web                                                     | Flutter                                             | Nội dung                                                                                 |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Loading          | `Skeleton` đúng hình dạng nội dung; spinner chỉ cho nút | `Skeleton` widget / `CircularProgressIndicator` nhỏ | Không để màn trắng                                                                       |
| Empty            | `EmptyState`: icon · tiêu đề · mô tả · hành động        | `EmptyState` widget                                 | "Chưa có BĐS nào" + nút "Thêm BĐS"; khác với "Không tìm thấy kết quả" (gợi ý xoá bộ lọc) |
| Error            | `ErrorState` + nút "Thử lại"; lỗi nhỏ dùng toast        | `ErrorState` / `SnackBar`                           | Nói rõ chuyện gì xảy ra và làm gì tiếp, không hiện stack trace                           |
| Không có quyền   | `ErrorState` biến thể 403                               | như web                                             | "Bạn không có quyền xem mục này"                                                         |
| Offline (mobile) | —                                                       | `MaterialBanner` trên cùng                          | "Mất kết nối. Dữ liệu có thể chưa mới nhất."                                             |

## Overlay

| Nhu cầu                            | Web                                | Flutter                     |
| ---------------------------------- | ---------------------------------- | --------------------------- |
| Xác nhận, form ngắn                | `Dialog` / `AlertDialog`           | `AlertDialog` / `Dialog`    |
| Form/chi tiết phụ, filter nâng cao | `Sheet` (drawer phải)              | `showModalBottomSheet`      |
| Menu hành động                     | `DropdownMenu`                     | `MenuAnchor` / bottom sheet |
| Gợi ý ngắn                         | `Tooltip`                          | `Tooltip`                   |
| Thông báo kết quả                  | `Sonner` toast (góc dưới phải, 4s) | `SnackBar`                  |

Không lồng dialog trong dialog. Esc và click ra ngoài đóng được (trừ khi có thay đổi chưa lưu).

## Dashboard & analytics

- Hàng `StatCard` (giá trị · nhãn · thay đổi so với kỳ trước có mũi tên + màu success/destructive), grid `1 / 2 / 4` cột.
- Biểu đồ: shadcn `chart` (Recharts), màu `chart1..5` theo thứ tự cố định. Funnel lead/sales, doanh thu theo thời gian, hiệu suất môi giới (bar ngang).
- Bộ chọn khoảng thời gian dùng chung cho cả dashboard.
- Số lớn có thể dùng Magic UI `number-ticker` (chạy một lần khi tải, tắt khi reduced-motion).

## Auth & settings

- Login: card giữa màn, logo, email/SĐT + mật khẩu, "Quên mật khẩu". Theo quyết định Phase 0, **không có đăng ký công khai** (tài khoản do admin tạo); màn Register chỉ làm nếu được duyệt (xem mâu thuẫn TASK-036).
- Settings: layout 2 cột trên desktop (menu trái, form phải), danh sách mục trên mobile.

## Pattern riêng cho BĐS

### Định dạng dữ liệu (dùng chung helper, không tự format từng chỗ)

| Dữ liệu   | Hiển thị                                                                   | Ghi chú                                                         |
| --------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Giá       | `3,2 tỷ`, `850 triệu`; trong bảng/chi tiết có thể đầy đủ `3.200.000.000 ₫` | `Intl.NumberFormat('vi-VN')` / `NumberFormat('#,###', 'vi_VN')` |
| Giá / m²  | `52,5 triệu/m²`                                                            |                                                                 |
| Diện tích | `120 m²`                                                                   |                                                                 |
| Ngày      | `04/10/2026`, thời gian tương đối cho thông báo ("5 phút trước")           | Múi giờ `Asia/Ho_Chi_Minh`                                      |
| SĐT       | `0912 345 678`                                                             | Lưu E.164 ở backend                                             |
| Địa chỉ   | Số nhà, đường, phường/xã, tỉnh/thành                                       | Đơn vị hành chính 2 cấp                                         |

### StatusBadge cho trạng thái BĐS (đề xuất, chờ duyệt)

| `status`          | Nhãn           | Màu           |
| ----------------- | -------------- | ------------- |
| `AVAILABLE`       | Đang bán       | `success`     |
| `PENDING`         | Đang giao dịch | `warning`     |
| `SOLD`            | Đã bán         | `info`        |
| `VERIFY_REQUIRED` | Cần xác minh   | `destructive` |
| `EXPIRED`         | Hết hạn        | `muted`       |
| `HIDDEN`          | Đã ẩn          | `muted`       |

Badge luôn có chữ, không chỉ chấm màu.

### PropertyCard

Ảnh bìa tỉ lệ 4:3 (`rounded-2xl`, lazy load, placeholder) · badge trạng thái góc ảnh · giá (`title`, `primary`) · tiêu đề 2 dòng · địa chỉ 1 dòng (`mutedForeground`) · hàng thông số icon: diện tích, phòng ngủ, hướng · nút yêu thích. Dùng cho danh sách mobile, kết quả tìm kiếm, matching. Biến thể ngang (`PropertyListItem`) cho danh sách dày.

### Thông tin chủ nhà bị giới hạn

Theo Phase 0 (kho dùng chung, liên hệ chủ nhà có kiểm soát): khi user không có quyền, hiển thị đúng giá trị đã che mà backend trả về (ví dụ `•••• ••• 678`) cùng icon khoá, thay vì ẩn hẳn khối. UI không bao giờ nhận dữ liệu thật rồi tự che. Có nút "Yêu cầu xem" hay không tuỳ business rule chưa được định nghĩa.
