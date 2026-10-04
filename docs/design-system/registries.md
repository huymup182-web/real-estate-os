# Nguồn UI, registry và MCP

## Hiện trạng project (kiểm tra 2026-10-04)

| Hạng mục              | Trạng thái                                                                      |
| --------------------- | ------------------------------------------------------------------------------- |
| Framework frontend    | Chưa có. `admin/` (Next.js) khởi tạo ở TASK-100, `mobile/` (Flutter) ở TASK-113 |
| `package.json` gốc    | Chỉ có công cụ chuẩn code (ESLint, Prettier, TypeScript)                        |
| Tailwind / shadcn/ui  | Chưa cài. Chưa có `components.json`                                             |
| Component hiện có     | Không có                                                                        |
| MCP server trong repo | Không có `.mcp.json`                                                            |
| Registry đã cấu hình  | Không có                                                                        |

Vì vậy phần lấy component bằng CLI/MCP bên dưới **bắt đầu dùng được từ TASK-100**. Trước đó, mọi quyết định UI đi qua token và tài liệu trong thư mục này.

## Web: thứ tự tìm component

### 1. shadcn/ui (nền tảng)

- Component copy vào repo (`components/ui/`), dựng trên Radix UI + Tailwind, accessible sẵn. Không phải thư viện npm khoá phiên bản, nên được sửa, nhưng **sửa ít nhất có thể** để còn cập nhật được.
- Ngoài component còn có **blocks** (dashboard, sidebar, login...) và **charts** (Recharts) — xem trước khi tự dựng layout.
- Lệnh (sau TASK-100, chạy trong `admin/`):

```bash
npx shadcn@latest search @shadcn -q "date"      # tìm
npx shadcn@latest view @shadcn/data-table       # xem trước code
npx shadcn@latest add button dialog form table  # thêm vào components/ui
npx shadcn@latest add sidebar-07                # thêm block
```

### 2. Magic UI — 3. Aceternity UI — 4. React Bits

Đều phân phối dạng **shadcn registry** (namespace), nên dùng cùng CLI: `npx shadcn@latest add @magicui/number-ticker`. Cần `motion` (Framer Motion) cho phần lớn component, là dependency mới, cần duyệt khi lần đầu dùng.

| Nguồn         | Hợp với project                                                                                                    | Tránh                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Magic UI      | Number ticker (số liệu dashboard), shimmer button, animated list (thông báo mới), border beam nhẹ cho card nổi bật | Hiệu ứng nền chạy liên tục trong màn làm việc |
| Aceternity UI | Trang login / landing nếu có, spotlight, card hover cho trang public                                               | Bất kỳ màn CRUD/bảng/form nào                 |
| React Bits    | Text animation cho onboarding, empty state                                                                         | Animation chữ trên nội dung nghiệp vụ         |

**License:** kiểm tra license của từng component trước khi đưa vào repo. Một số nguồn có bản Pro trả phí hoặc điều khoản riêng (ví dụ React Bits dùng MIT kèm Commons Clause; Aceternity có bản Pro). Ghi nguồn + license vào [component-inventory.md](component-inventory.md) khi thêm.

### 5. Tailark

Section, layout kiểu SaaS (hero, features, pricing, footer), cũng theo shadcn registry. Chỉ dùng nếu có trang public/marketing — roadmap hiện tại chưa có.

### Cấu hình registry (đề xuất cho TASK-100)

`admin/components.json` (tạo bởi `npx shadcn@latest init`), thêm khối `registries` nếu namespace chưa tự nhận:

```jsonc
{
  "style": "new-york",
  "tailwind": { "css": "src/app/globals.css", "baseColor": "slate", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks",
    "utils": "@/lib/utils",
  },
  "registries": {
    "@magicui": "https://magicui.design/r/{name}.json",
    "@aceternity": "https://ui.aceternity.com/registry/{name}.json",
    "@react-bits": "https://reactbits.dev/r/{name}.json",
    "@tailark": "https://tailark.com/r/{name}.json",
  },
}
```

URL registry ở trên cần xác minh lại khi chạy thật (`npx shadcn@latest view @magicui/marquee`): môi trường cloud lúc viết tài liệu này không truy cập được các domain đó. CLI shadcn tự tra danh mục registry công khai, nên nhiều namespace có thể không cần khai báo.

### MCP cho Claude Code (bật ở TASK-100)

shadcn CLI có sẵn MCP server, cho Claude tìm, xem và thêm component từ mọi registry đã cấu hình:

```bash
cd admin && npx shadcn@latest mcp init --client claude   # tạo .mcp.json
```

Các tool chính: `search_items_in_registries`, `view_items_in_registries`, `get_item_examples_from_registries`, `get_add_command_for_items`, `get_audit_checklist`. MCP này **cần `components.json`**, nên chưa thêm vào repo bây giờ. Khi có, skill `ui-system` dùng MCP trước, CLI sau.

## Flutter: thứ tự tìm widget

1. Widget đã có trong `mobile/lib/shared/widgets/`.
2. Widget **Material 3** có sẵn trong Flutter SDK (`NavigationBar`, `SearchAnchor`, `FilterChip`, `ModalBottomSheet`, `DataTable`...), theme bằng token.
3. Cupertino khi cần cảm giác iOS riêng (date picker, action sheet), theo Apple HIG.
4. Package pub.dev: chỉ khi SDK không có, cần duyệt dependency (đúng quy tắc §33).
5. Custom widget.

Flutter không có registry kiểu shadcn; "registry" của mobile chính là danh mục widget trong [component-inventory.md](component-inventory.md).

## Nguyên tắc thiết kế tham chiếu

| Nguồn                   | Lấy gì                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Material Design 3       | Color roles, type scale, window size class, component behavior, motion easing               |
| Apple HIG               | Vùng chạm 44pt, điều hướng mobile, safe area, gesture, ngôn ngữ ngắn gọn                    |
| Atlassian Design System | Pattern cho công cụ nghiệp vụ: bảng dữ liệu, form dài, empty state, thông báo, nội dung lỗi |
| WCAG 2.2                | Tương phản, focus, bàn phím, target size                                                    |

## Inspiration (chỉ tham khảo)

Mobbin (flow mobile thật), Dribbble, Behance, Land-book, Awwwards. Khi dùng, ghi lại phân tích theo mẫu, không copy:

```text
Nguồn: <link>
Layout: ...           Component: ... (map sang component nào của project)
Interaction: ...      Typography / spacing / màu: ... (map sang token nào)
Behavior: ...         Giữ lại / bỏ: ...
```
