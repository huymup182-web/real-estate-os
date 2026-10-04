# Component inventory

Danh mục **mọi** component dùng chung của project. Trước khi tạo component mới, tìm ở đây trước. Khi thêm component, cập nhật bảng (trạng thái, đường dẫn, nguồn, license nếu từ registry ngoài shadcn).

Trạng thái: `planned` (dự kiến, chưa có code) · `ready` (đã có, dùng được) · `deprecated` (không dùng nữa, ghi thay bằng gì).

> 2026-10-04: chưa có app frontend nên tất cả đang `planned`. Task trong cột "Khi nào" là task roadmap đầu tiên cần đến component đó.

## Cấu trúc thư mục

### Admin web (`admin/`, Next.js App Router, tạo ở TASK-100)

```text
admin/src/
├── app/                      # route; globals.css chứa nội dung tokens.css
├── components/
│   ├── ui/                   # shadcn/ui + item từ registry (Magic UI...). Sinh bằng CLI, sửa tối thiểu
│   ├── layout/               # AppShell, AppSidebar, AppHeader, PageHeader, PageContainer
│   ├── navigation/           # NavMain, UserMenu, Breadcrumbs, CommandSearch, MobileNav
│   ├── forms/                # FormSection, SearchInput, PriceInput, AreaInput, PhoneInput, LocationSelect, ImageUploader
│   ├── data-display/         # DataTable, StatCard, StatusBadge, PropertyCard, KeyValueList, charts
│   └── feedback/             # EmptyState, ErrorState, LoadingSkeleton, ConfirmDialog
├── features/<module>/        # component chỉ dùng trong một module (properties, customers...)
├── hooks/                    # use-debounce, use-media-query...
└── lib/                      # utils (cn), format (giá, diện tích, ngày), api client
```

Quy tắc: `components/ui/` là "nguyên liệu" (không chứa logic nghiệp vụ, không gọi API). Các thư mục còn lại compose từ `ui/`. Component chỉ một module dùng nằm trong `features/<module>/`; khi module thứ hai cần thì chuyển lên `components/`.

### Mobile (`mobile/`, Flutter, tạo ở TASK-113)

```text
mobile/lib/
├── core/theme/               # app_tokens.dart (sinh tự động), app_theme.dart (ThemeData từ token) — TASK-114
├── shared/widgets/
│   ├── layout/               # AppScaffold, ResponsiveLayout, Section
│   ├── navigation/           # AppNavigationBar (bottom nav / rail)
│   ├── forms/                # AppTextField, PriceField, AreaField, PhoneField, LocationPicker, ImagePickerGrid
│   ├── data_display/         # PropertyCard, PropertyListItem, StatusBadge, StatCard, KeyValueRow
│   └── feedback/             # EmptyState, ErrorState, Skeleton, ConfirmDialog
├── shared/utils/format.dart  # giá, diện tích, ngày (cùng quy tắc với web)
└── features/<module>/        # màn hình + widget riêng của module
```

Cùng tên component ở web và Flutter cho cùng một pattern (PropertyCard, StatusBadge, EmptyState...).

## Danh mục

### ui/ — primitives (web: shadcn/ui; Flutter: Material 3)

| Component               | Web (nguồn)                                 | Flutter                                          | Khi nào        | Trạng thái |
| ----------------------- | ------------------------------------------- | ------------------------------------------------ | -------------- | ---------- |
| Button                  | `@shadcn/button`                            | `FilledButton` / `OutlinedButton` / `TextButton` | TASK-101 / 116 | planned    |
| Input, Textarea         | `@shadcn/input`, `textarea`                 | `TextField`                                      | TASK-101 / 116 | planned    |
| Label, Form             | `@shadcn/label`, `form`                     | `Form`, `TextFormField`                          | TASK-101 / 116 | planned    |
| Select, Combobox        | `@shadcn/select`, `combobox`                | `DropdownMenu`                                   | TASK-103 / 120 | planned    |
| Checkbox, Radio, Switch | `@shadcn/checkbox`, `radio-group`, `switch` | `Checkbox`, `Radio`, `Switch`                    | TASK-103 / 120 | planned    |
| Date picker             | `@shadcn/calendar` + `popover`              | `showDatePicker`                                 | TASK-109 / 129 | planned    |
| Card                    | `@shadcn/card`                              | `Card`                                           | TASK-102 / 117 | planned    |
| Badge                   | `@shadcn/badge`                             | `Chip` / custom `StatusBadge`                    | TASK-102 / 118 | planned    |
| Avatar                  | `@shadcn/avatar`                            | `CircleAvatar`                                   | TASK-102 / 131 | planned    |
| Table                   | `@shadcn/table`                             | `DataTable` (ít dùng trên mobile)                | TASK-103       | planned    |
| Tabs                    | `@shadcn/tabs`                              | `TabBar`                                         | TASK-107 / 121 | planned    |
| Dialog, Alert dialog    | `@shadcn/dialog`, `alert-dialog`            | `AlertDialog`, `Dialog`                          | TASK-103 / 122 | planned    |
| Sheet (drawer)          | `@shadcn/sheet`                             | `showModalBottomSheet`                           | TASK-102 / 120 | planned    |
| Dropdown menu           | `@shadcn/dropdown-menu`                     | `MenuAnchor`                                     | TASK-102       | planned    |
| Tooltip                 | `@shadcn/tooltip`                           | `Tooltip`                                        | TASK-102       | planned    |
| Toast                   | `@shadcn/sonner`                            | `SnackBar`                                       | TASK-101 / 116 | planned    |
| Skeleton                | `@shadcn/skeleton`                          | custom `Skeleton`                                | TASK-102 / 117 | planned    |
| Pagination              | `@shadcn/pagination`                        | cuộn vô hạn                                      | TASK-103       | planned    |
| Command (⌘K)            | `@shadcn/command`                           | `SearchAnchor`                                   | TASK-102 / 119 | planned    |
| Breadcrumb              | `@shadcn/breadcrumb`                        | —                                                | TASK-102       | planned    |
| Sidebar                 | `@shadcn/sidebar` (+ block `sidebar-07`)    | `NavigationRail` (tablet)                        | TASK-102       | planned    |
| Chart                   | `@shadcn/chart` (Recharts)                  | cần duyệt package (vd fl_chart)                  | TASK-102       | planned    |
| Number ticker           | `@magicui/number-ticker` (tuỳ chọn)         | `TweenAnimationBuilder`                          | TASK-102       | planned    |

### layout/

| Component                  | Mô tả                                     | Compose từ                          | Trạng thái |
| -------------------------- | ----------------------------------------- | ----------------------------------- | ---------- |
| AppShell                   | Khung admin: sidebar + header + nội dung  | Sidebar, AppHeader                  | planned    |
| AppHeader                  | Breadcrumbs, search, thông báo, user menu | Breadcrumb, CommandSearch, UserMenu | planned    |
| PageHeader                 | Tiêu đề, mô tả, hành động chính của trang | Button                              | planned    |
| PageContainer              | Max width + gutter theo breakpoint        | —                                   | planned    |
| AppScaffold (Flutter)      | Scaffold + AppBar + safe area chuẩn       | `Scaffold`                          | planned    |
| ResponsiveLayout (Flutter) | Chọn layout theo `AppBreakpoints`         | `LayoutBuilder`                     | planned    |

### navigation/

| Component                  | Mô tả                                         | Compose từ                        | Trạng thái |
| -------------------------- | --------------------------------------------- | --------------------------------- | ---------- |
| NavMain                    | Menu module theo quyền                        | Sidebar                           | planned    |
| UserMenu                   | Avatar + menu tài khoản, đổi theme, đăng xuất | Avatar, DropdownMenu              | planned    |
| CommandSearch              | Tìm nhanh ⌘K                                  | Command, Dialog                   | planned    |
| MobileNav (web)            | Sidebar dạng drawer dưới `lg`                 | Sheet                             | planned    |
| AppNavigationBar (Flutter) | 5 tab §24, rail trên tablet                   | `NavigationBar`, `NavigationRail` | planned    |

### forms/

| Component      | Mô tả                                                  | Compose từ           | Trạng thái |
| -------------- | ------------------------------------------------------ | -------------------- | ---------- |
| FormSection    | Nhóm field có tiêu đề + mô tả                          | Card / Separator     | planned    |
| SearchInput    | Ô tìm có icon, nút xoá, debounce                       | Input                | planned    |
| PriceInput     | Nhập VND, format hàng nghìn, hiện "≈ 3,2 tỷ"           | Input, lib/format    | planned    |
| AreaInput      | Nhập m²                                                | Input                | planned    |
| PhoneInput     | SĐT Việt Nam, chuẩn hoá +84                            | Input                | planned    |
| LocationSelect | Tỉnh/thành → phường/xã (2 cấp)                         | Combobox             | planned    |
| ImageUploader  | Chọn, xem trước, sắp xếp, chọn ảnh bìa                 | Button, Card         | planned    |
| FilterBar      | Filter nhanh + nút filter nâng cao + chip đang áp dụng | Select, Badge, Sheet | planned    |

### data-display/

| Component        | Mô tả                                            | Compose từ                         | Trạng thái |
| ---------------- | ------------------------------------------------ | ---------------------------------- | ---------- |
| DataTable        | Bảng server-side: sort, filter, phân trang, chọn | Table + TanStack Table, Pagination | planned    |
| StatCard         | Số liệu + thay đổi so với kỳ trước               | Card                               | planned    |
| StatusBadge      | Trạng thái nghiệp vụ → nhãn + màu (patterns.md)  | Badge                              | planned    |
| PropertyCard     | Thẻ BĐS (ảnh, giá, địa chỉ, thông số)            | Card, StatusBadge                  | planned    |
| PropertyListItem | Biến thể ngang của PropertyCard                  | Card                               | planned    |
| KeyValueList     | Danh sách thuộc tính ở trang chi tiết            | —                                  | planned    |
| ChartCard        | Card chứa biểu đồ + tiêu đề + chọn kỳ            | Card, Chart                        | planned    |

### feedback/

| Component       | Mô tả                                   | Compose từ  | Trạng thái |
| --------------- | --------------------------------------- | ----------- | ---------- |
| EmptyState      | Icon, tiêu đề, mô tả, hành động         | Button      | planned    |
| ErrorState      | Lỗi + "Thử lại"; biến thể 403, 404      | Button      | planned    |
| LoadingSkeleton | Skeleton cho bảng, card, trang chi tiết | Skeleton    | planned    |
| ConfirmDialog   | Xác nhận hành động nguy hiểm            | AlertDialog | planned    |

## Dependency dự kiến (cần duyệt ở task tương ứng, chưa cài)

| Nền tảng | Package                                                                          | Vì sao                                | Task     |
| -------- | -------------------------------------------------------------------------------- | ------------------------------------- | -------- |
| Web      | `tailwindcss` v4, `tw-animate-css`                                               | Styling theo token                    | TASK-100 |
| Web      | `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` | Do shadcn/ui cài khi `init`/`add`     | TASK-100 |
| Web      | `react-hook-form`, `zod`, `@hookform/resolvers`                                  | shadcn `form`                         | TASK-101 |
| Web      | `sonner`, `next-themes`                                                          | Toast, dark mode                      | TASK-101 |
| Web      | `@tanstack/react-table`                                                          | DataTable                             | TASK-103 |
| Web      | `recharts`                                                                       | shadcn `chart`                        | TASK-102 |
| Web      | `motion`                                                                         | Chỉ khi dùng item Magic UI/Aceternity | khi cần  |
| Flutter  | Font Be Vietnam Pro (asset trong app, không cần package)                         | Typography                            | TASK-114 |
| Flutter  | Icon Lucide bản Flutter (tuỳ chọn) hoặc Material Symbols có sẵn                  | Icon giống web                        | TASK-113 |
