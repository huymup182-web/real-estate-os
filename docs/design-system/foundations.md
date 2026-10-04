# Foundations (design token)

Mọi giá trị dưới đây đến từ [tokens/tokens.json](tokens/tokens.json). Bảng này để tra cứu; khi lệch nhau, `tokens.json` đúng.

Cách dùng chung: **web** dùng class Tailwind sinh từ token (`bg-primary`, `text-muted-foreground`, `p-4`, `rounded-lg`, `shadow-md`); **Flutter** dùng `Theme.of(context)` hoặc hằng số trong `app_tokens.dart` (`AppSpacing.s16`, `AppRadius.lg`). Không viết hex, px, font, duration tuỳ ý.

## 1. Màu

### Vai trò màu (semantic)

Tên vai trò giống biến CSS của shadcn/ui để component shadcn và registry dùng được ngay. Mỗi màu nền có màu chữ `*Foreground` đi kèm.

| Vai trò                         | Dùng cho                                                  | Light                 | Dark                  | Flutter ColorScheme                            |
| ------------------------------- | --------------------------------------------------------- | --------------------- | --------------------- | ---------------------------------------------- |
| `background` / `foreground`     | Nền trang, chữ chính                                      | `#FFFFFF` / `#0F172A` | `#020617` / `#F8FAFC` | `surface` / `onSurface`                        |
| `card` / `cardForeground`       | Card, panel                                               | `#FFFFFF`             | `#0F172A`             | `surfaceContainerLow`                          |
| `popover`                       | Dropdown, popover, menu                                   | `#FFFFFF`             | `#0F172A`             | —                                              |
| `primary` / `primaryForeground` | Hành động chính, link, trạng thái chọn                    | `#1D4ED8`             | `#60A5FA`             | `primary` / `onPrimary`                        |
| `secondary`                     | Nút phụ                                                   | `#F1F5F9`             | `#1E293B`             | `secondary`                                    |
| `muted` / `mutedForeground`     | Nền nhạt, chữ phụ, placeholder, metadata                  | `#F1F5F9` / `#475569` | `#1E293B` / `#94A3B8` | `surfaceContainerHighest` / `onSurfaceVariant` |
| `accent` / `accentForeground`   | Hover, mục đang chọn trong menu                           | `#EFF6FF` / `#1E40AF` | `#172554` / `#BFDBFE` | `primaryContainer` / `onPrimaryContainer`      |
| `destructive`                   | Xoá, lỗi                                                  | `#DC2626`             | `#F87171`             | `error` / `onError`                            |
| `success`                       | Thành công, BĐS còn hàng                                  | `#15803D`             | `#4ADE80`             | `AppColorTokens.success`                       |
| `warning`                       | Cảnh báo, chờ xác minh                                    | `#B45309`             | `#FBBF24`             | `AppColorTokens.warning`                       |
| `info`                          | Thông tin, gợi ý                                          | `#0369A1`             | `#38BDF8`             | `AppColorTokens.info`                          |
| `border`                        | Đường kẻ, viền card, divider                              | `#E2E8F0`             | `#1E293B`             | `outlineVariant`                               |
| `input`                         | Viền input, checkbox, select (≥ 3:1 với nền, WCAG 1.4.11) | `#7C8BA1`             | `#64748B`             | `outline`                                      |
| `ring`                          | Focus ring                                                | `#2563EB`             | `#60A5FA`             | —                                              |
| `chart1..5`                     | Biểu đồ (thứ tự cố định: xanh, teal, cam, hồng, tím)      | xem json              | xem json              | `AppColorTokens.chart1..5`                     |
| `sidebar*`                      | Sidebar admin                                             | xem json              | xem json              | —                                              |

Quy tắc:

- Chỉ dùng vai trò, không dùng thẳng palette (`brand.700`) trong component. Palette chỉ để định nghĩa vai trò.
- Không truyền đạt thông tin chỉ bằng màu: trạng thái luôn có chữ hoặc icon đi kèm.
- `success`/`warning`/`info` có thể dùng dạng nhẹ cho badge: nền `bg-success/10`, chữ `text-success` (web); `success.withValues(alpha: 0.1)` (Flutter).

### Tương phản (kiểm tra tự động)

`npm run check` fail nếu một cặp dưới ngưỡng. Kết quả hiện tại:

| Cặp                                 | Light | Dark  | Ngưỡng |
| ----------------------------------- | ----- | ----- | ------ |
| foreground / background             | 17.85 | 19.28 | 4.5    |
| primaryForeground / primary         | 6.70  | 5.78  | 4.5    |
| mutedForeground / muted             | 6.92  | 5.71  | 4.5    |
| destructiveForeground / destructive | 4.83  | 5.84  | 4.5    |
| successForeground / success         | 5.02  | 8.55  | 4.5    |
| warningForeground / warning         | 5.02  | 8.97  | 4.5    |
| infoForeground / info               | 5.93  | 6.48  | 4.5    |
| input / background                  | 3.46  | 4.24  | 3      |
| ring / background                   | 5.17  | 7.93  | 3      |

Danh sách cặp đầy đủ ở `contrast.pairs` trong `tokens.json`. Thêm vai trò màu mới thì thêm cặp tương phản của nó.

### Dark mode

- Web: class `.dark` trên `<html>` (next-themes, mặc định theo hệ thống). Viết `bg-background`, không viết `bg-white dark:bg-slate-950`.
- Flutter: `MaterialApp(theme: light, darkTheme: dark, themeMode: ThemeMode.system)`.

## 2. Typography

Font: **Be Vietnam Pro** (dấu tiếng Việt chuẩn), dự phòng `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. Số liệu trong bảng dùng `tabular-nums` (web) / `FontFeature.tabularFigures()` (Flutter).

| Kiểu       | Cỡ / dòng (px) | Weight   | Web (Tailwind)           | Flutter TextTheme |
| ---------- | -------------- | -------- | ------------------------ | ----------------- |
| `display`  | 36 / 40        | bold     | `text-4xl font-bold`     | `displaySmall`    |
| `h1`       | 30 / 36        | semibold | `text-3xl font-semibold` | `headlineLarge`   |
| `h2`       | 24 / 32        | semibold | `text-2xl font-semibold` | `headlineMedium`  |
| `h3`       | 20 / 28        | semibold | `text-xl font-semibold`  | `headlineSmall`   |
| `title`    | 18 / 28        | semibold | `text-lg font-semibold`  | `titleLarge`      |
| `subtitle` | 16 / 24        | medium   | `text-base font-medium`  | `titleMedium`     |
| `body`     | 16 / 24        | regular  | `text-base`              | `bodyLarge`       |
| `bodySm`   | 14 / 20        | regular  | `text-sm`                | `bodyMedium`      |
| `label`    | 14 / 20        | medium   | `text-sm font-medium`    | `labelLarge`      |
| `caption`  | 12 / 16        | regular  | `text-xs`                | `bodySmall`       |

Quy tắc: tối đa 3 cỡ chữ trên một màn hình mobile, 4 trên admin. Admin dùng `text-sm` làm cỡ mặc định cho bảng và form (mật độ cao); mobile dùng `body` 16px (đọc ngoài trời, không bị iOS zoom khi focus input). Weight chỉ dùng 400/500/600/700.

## 3. Spacing

Lưới 4px. Chỉ dùng các bước sau:

| px  | Tailwind | Dart            |
| --- | -------- | --------------- |
| 0   | `0`      | `AppSpacing.s0` |
| 2   | `0.5`    | `s2`            |
| 4   | `1`      | `s4`            |
| 6   | `1.5`    | `s6`            |
| 8   | `2`      | `s8`            |
| 12  | `3`      | `s12`           |
| 16  | `4`      | `s16`           |
| 20  | `5`      | `s20`           |
| 24  | `6`      | `s24`           |
| 32  | `8`      | `s32`           |
| 40  | `10`     | `s40`           |
| 48  | `12`     | `s48`           |
| 64  | `16`     | `s64`           |

Gợi ý: trong component 8–12, giữa các control trong form 16, giữa các section 24–32, padding card 16 (mobile) / 24 (desktop).

## 4. Radius

| Token  | px   | Dùng cho                                   |
| ------ | ---- | ------------------------------------------ |
| `sm`   | 4    | Badge, tag, checkbox                       |
| `md`   | 6    | Input, button nhỏ                          |
| `lg`   | 8    | Button, input, card (mặc định, `--radius`) |
| `xl`   | 12   | Card lớn, dialog, bottom sheet             |
| `2xl`  | 16   | Ảnh BĐS, hero                              |
| `full` | 9999 | Avatar, pill, FAB                          |

Dart: `AppRadius.sm/md/lg/xl/xxl/full`.

## 5. Shadow / elevation

`sm` (card nằm trên nền), `md` (dropdown, popover), `lg` (dialog, drawer), `xl` (toast nổi, kéo thả). Dark mode ưu tiên phân lớp bằng màu nền (`card` sáng hơn `background`) thay vì shadow. Dart: `AppShadows.sm/md/lg/xl` (`List<BoxShadow>`).

## 6. Breakpoint & layout

Web (Tailwind, min-width): `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536.

Flutter theo window size class Material 3: compact < 600 ≤ medium < 840 ≤ expanded < 1200 ≤ large (`AppBreakpoints`).

| Token                           | Giá trị      | Ghi chú                                       |
| ------------------------------- | ------------ | --------------------------------------------- |
| `containerMaxWidth`             | 1280         | Nội dung trang admin                          |
| `sidebarWidth` / collapsed      | 256 / 64     | Sidebar admin; dưới `lg` thành drawer (Sheet) |
| `headerHeight`                  | 56           | Header admin, AppBar mobile                   |
| `bottomNavHeight`               | 64           | Bottom navigation mobile                      |
| `gutterCompact/Medium/Expanded` | 16 / 24 / 32 | Padding ngang trang theo kích thước màn hình  |
| `minTouchTarget`                | 44           | Vùng chạm tối thiểu (Apple HIG 44pt, M3 48dp) |

Grid: admin dùng CSS grid 12 cột ở `lg+`, 1 cột ở mobile; card dashboard `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`. Mobile-first: viết style cho màn nhỏ trước rồi thêm `md:`, `lg:`.

## 7. Motion

| Token    | ms  | Dùng cho                                  |
| -------- | --- | ----------------------------------------- |
| `fast`   | 150 | Hover, đổi màu, checkbox                  |
| `normal` | 200 | Dropdown, tooltip, tab                    |
| `slow`   | 300 | Dialog, drawer, bottom sheet              |
| `slower` | 500 | Chuyển trang, hiệu ứng nhấn mạnh hiếm khi |

Easing: `standard` cubic-bezier(0.2, 0, 0, 1) cho đa số; `decelerate` khi phần tử xuất hiện; `accelerate` khi biến mất. Web: `duration-(--duration-normal) ease-standard`; Dart: `AppDurations.normal`, `AppEasing.standard`.

Luôn tôn trọng giảm chuyển động: web `motion-safe:` / `motion-reduce:`; Flutter `MediaQuery.disableAnimationsOf(context)`. Không animate thông tin quan trọng (giá, trạng thái).

## 8. Icon

- Web: **Lucide** (`lucide-react`, mặc định của shadcn/ui). Flutter: icon Material Symbols có sẵn; dùng Lucide bản Flutter để giống web hơn cần duyệt dependency ở TASK-113.
- Cỡ: `sm` 16 (trong text, badge), `md` 20 (button, input, menu), `lg` 24 (navigation, header). Stroke 2.
- Icon đứng một mình (không chữ) phải có `aria-label` / `sr-only` (web) hoặc `tooltip`/`semanticLabel` (Flutter).

## 9. Z-index

`base 0 < sticky 10 < header 20 < overlay 40 < modal 50 < popover 60 < toast 100`. Popover cao hơn modal để select/date picker mở được trong dialog. Web: `z-(--z-modal)`.

## 10. Accessibility (bắt buộc)

- Tương phản theo bảng trên; không giảm opacity chữ để làm "chữ phụ", dùng `mutedForeground`.
- Focus thấy rõ: `focus-visible:ring-2 ring-ring ring-offset-2` (shadcn mặc định). Không bỏ outline.
- Bàn phím: mọi hành động làm được bằng Tab/Enter/Space/Esc; dialog giữ focus và trả focus khi đóng (Radix lo sẵn).
- Form: mỗi input có `<Label>`, lỗi gắn bằng `aria-describedby` (shadcn `Form` lo sẵn), không chỉ báo lỗi bằng màu đỏ.
- Ngôn ngữ: `<html lang="vi">`. Flutter: `Semantics`, `MergeSemantics`, hỗ trợ text scale tới 200% không vỡ layout.
- Vùng chạm ≥ 44px trên mobile.
