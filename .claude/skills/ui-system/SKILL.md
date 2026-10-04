---
name: ui-system
description: Bắt buộc dùng trước khi tạo hoặc sửa bất kỳ giao diện nào của AI Real Estate OS (admin Next.js trong admin/, app Flutter trong mobile/) - màn hình, component, layout, form, bảng, style, màu, animation. Hướng dẫn tìm component có sẵn, registry shadcn/ui, design token và checklist UX/accessibility.
---

# UI system — AI Real Estate OS

Mục tiêu: **không code UI từ số 0** khi đã có component/pattern tốt. Mọi UI dùng token chung và trông như một sản phẩm trên web và mobile.

Tài liệu nguồn (đọc phần liên quan trước khi code):

- `docs/design-system/README.md` — nguyên tắc, thứ tự ưu tiên nguồn
- `docs/design-system/foundations.md` — token: màu, chữ, spacing, radius, shadow, breakpoint, motion, icon, a11y
- `docs/design-system/patterns.md` — CRUD, bảng, form, filter, trạng thái, overlay, dashboard, pattern BĐS
- `docs/design-system/component-inventory.md` — component đã có / dự kiến, cấu trúc thư mục
- `docs/design-system/registries.md` — shadcn/ui, Magic UI, Aceternity, React Bits, Tailark, MCP, license
- `docs/design-system/tokens/tokens.json` — nguồn token duy nhất

Quy tắc dự án vẫn áp dụng: chỉ làm task được giao, không thêm dependency khi chưa được duyệt, không đổi kiến trúc, business logic và kiểm tra quyền ở backend.

## Quy trình (làm theo thứ tự, không bỏ bước)

### 1. Requirement → phân tích UX

- Ai dùng (admin, quản lý, môi giới ngoài hiện trường), trên thiết bị nào, mục tiêu chính của màn hình là gì.
- Liệt kê dữ liệu hiển thị, hành động, quyền cần có, các trạng thái: loading / empty / error / có dữ liệu / không có quyền.
- Map yêu cầu vào pattern trong `patterns.md` (CRUD, DataTable, FilterBar, Dialog vs Sheet...). Nếu không khớp pattern nào, nói rõ trước khi tự nghĩ layout mới.

### 2. Kiểm tra component đã có

```bash
# Danh mục
grep -n "ready" docs/design-system/component-inventory.md
# Web
ls admin/src/components/*/ 2>/dev/null; grep -rl "export function <Ten>" admin/src/components admin/src/features 2>/dev/null
# Flutter
ls mobile/lib/shared/widgets/*/ 2>/dev/null; grep -rn "class <Ten> extends" mobile/lib 2>/dev/null
```

Có rồi → dùng lại, mở rộng bằng prop/variant (cva) thay vì copy. Gần đúng → compose hoặc thêm variant. **Không tạo component trùng chức năng.**

### 3. Tìm trong registry (web)

Thứ tự: **shadcn/ui** (component, blocks, charts) → Magic UI → Aceternity UI → React Bits → Tailark.

- Có MCP `shadcn` (tool `search_items_in_registries`, `view_items_in_registries`, `get_item_examples_from_registries`, `get_add_command_for_items`): dùng MCP trước.
- Không có MCP: CLI trong `admin/`:
  `npx shadcn@latest search @shadcn -q "<từ khoá>"` → `npx shadcn@latest view @shadcn/<item>` → `npx shadcn@latest add <item>`.
- Magic UI/Aceternity/React Bits chỉ cho hiệu ứng có chủ đích (login, empty state, số liệu dashboard). Không dùng cho bảng, form, CRUD. Item kéo theo dependency mới (vd `motion`) → hỏi user trước. Kiểm tra license, ghi vào inventory.
- Chưa có `admin/` (trước TASK-100) → không chạy CLI, không tự khởi tạo Next.js/Tailwind/shadcn; hỏi user.

Flutter: widget trong `mobile/lib/shared/widgets/` → Material 3 trong SDK → Cupertino khi cần cảm giác iOS → package pub.dev (cần duyệt) → custom.

### 4. Chọn, reuse, customize

- Customize bằng token và variant, không sửa logic Radix trong `components/ui/`.
- Component nghiệp vụ dùng chung đặt đúng thư mục: `layout/`, `navigation/`, `forms/`, `data-display/`, `feedback/` (web) hoặc `shared/widgets/<nhóm>/` (Flutter). Chỉ một module dùng → `features/<module>/`.
- Chỉ viết custom component khi trả lời "không" cho cả ba câu: _Đã tồn tại chưa? Lấy được từ registry nào? Compose được từ component hiện có không?_ Ghi lý do trong PR.

### 5. Style chỉ bằng token

- Web: class Tailwind từ token (`bg-primary`, `text-muted-foreground`, `border-border`, `p-4`, `gap-6`, `rounded-lg`, `shadow-md`, `duration-(--duration-normal)`, `ease-standard`). **Cấm** hex/rgb, `p-[13px]`, `text-[15px]`, `bg-white dark:bg-...`.
- Flutter: `Theme.of(context).colorScheme`, `textTheme`, `AppColorTokens`, `AppSpacing.s16`, `AppRadius.lg`, `AppDurations.normal`. **Cấm** `Color(0xFF...)`, số px rời rạc ngoài token.
- Thiếu token → thêm vào `tokens.json`, chạy `npm run tokens:build`, cập nhật `foundations.md`. Không đặt token cục bộ trong component.
- Icon: Lucide (web), cỡ 16/20/24.
- Định dạng giá/diện tích/ngày/SĐT qua helper chung (`lib/format` / `shared/utils/format.dart`), theo bảng trong `patterns.md`.

### 6. Kiểm tra trước khi xong

**Responsive**

- [ ] Mobile-first; thử 375, 768, 1024, 1440 (web) / compact, medium, expanded (Flutter)
- [ ] Không cuộn ngang toàn trang; bảng chuyển thành card dưới `md`
- [ ] Sidebar thành drawer dưới `lg`; tablet Flutter dùng NavigationRail

**Accessibility (WCAG 2.2 AA)**

- [ ] Chỉ dùng cặp màu vai trò (đã kiểm tra tương phản); không truyền thông tin chỉ bằng màu
- [ ] Dùng được hoàn toàn bằng bàn phím; focus ring thấy rõ; dialog giữ và trả focus
- [ ] Input có label; lỗi gắn với field; icon-only button có `aria-label`/`semanticLabel`
- [ ] Vùng chạm ≥ 44px trên mobile; text scale 200% (Flutter) không vỡ
- [ ] `prefers-reduced-motion` / `disableAnimations` được tôn trọng

**Consistency**

- [ ] Đủ 4 trạng thái loading/empty/error/data dùng `LoadingSkeleton`/`EmptyState`/`ErrorState`
- [ ] Toast sau thao tác ghi; ConfirmDialog cho hành động nguy hiểm
- [ ] Tên, vị trí hành động chính, cách hiển thị trạng thái giống các màn đã có
- [ ] Light và dark mode đều đúng

### 7. Implement → test

- Web: test component có logic (format, filter, state) bằng test runner của `admin/`; chạy lint/typecheck/test/build.
- Flutter: widget test cho widget dùng chung; `flutter analyze` + `flutter test`.
- `npm run check` ở gốc (bao gồm kiểm tra token).

### 8. Cập nhật inventory

Thêm/sửa dòng trong `docs/design-system/component-inventory.md`: trạng thái `ready`, đường dẫn file, nguồn (shadcn item, registry + license, hoặc custom + lý do). Inventory lệch với code là lỗi.

## Inspiration

Mobbin/Dribbble/Behance/Land-book/Awwwards chỉ để tham khảo. Phân tích thành layout, component, interaction, typography, spacing, màu, behavior; map sang component + token của project; không sao chép thiết kế hay thương hiệu (đặc biệt Đại Thế Kỷ).
