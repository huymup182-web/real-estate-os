# Design System & UI Arsenal

Hệ thống giao diện chung cho **admin web** (Next.js, TASK-100) và **mobile** (Flutter, TASK-113). Mục tiêu: mọi màn hình được ráp từ component và pattern có sẵn, không viết lại UI từ số 0, và hai nền tảng trông như một sản phẩm.

> Trạng thái (2026-10-04): token, tài liệu và skill đã có. Chưa có app frontend nào được khởi tạo, nên chưa có component code. Component được thêm dần theo roadmap và ghi vào [component-inventory.md](component-inventory.md).

## Tài liệu

| File                                             | Nội dung                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [foundations.md](foundations.md)                 | Token: màu, chữ, spacing, radius, shadow, breakpoint, layout, motion, icon, dark mode          |
| [registries.md](registries.md)                   | Nguồn UI (shadcn/ui, Magic UI, Aceternity, React Bits, Tailark...), MCP, license, cách lấy     |
| [patterns.md](patterns.md)                       | UX pattern: CRUD, bảng, form, filter, trạng thái, điều hướng, pattern riêng của BĐS            |
| [component-inventory.md](component-inventory.md) | Danh mục component (đã có / dự kiến), cấu trúc thư mục web + Flutter, nguồn của từng component |
| [tokens/tokens.json](tokens/tokens.json)         | **Nguồn duy nhất** của design token                                                            |
| [tokens/generated/](tokens/generated/)           | `tokens.css` (Tailwind v4 + shadcn/ui) và `app_tokens.dart` (Flutter), sinh tự động            |
| [../../.claude/skills/ui-system/SKILL.md][skill] | Quy trình Claude Code phải theo mỗi khi làm UI                                                 |

[skill]: ../../.claude/skills/ui-system/SKILL.md

## Nguyên tắc

1. **Reuse trước, tạo sau.** Thứ tự: component đã có trong project → compose từ component đã có → registry (shadcn/ui trước) → custom. Không tạo hai component cùng chức năng.
2. **Token là luật.** Không viết hex, px, font, shadow, duration tuỳ ý trong code. Thiếu token thì thêm vào `tokens.json` rồi chạy `npm run tokens:build`.
3. **Một sản phẩm, hai nền tảng.** Web và Flutter dùng chung token, tên vai trò màu và tên pattern. Widget Flutter đi theo Material 3, được theme bằng cùng token.
4. **Công cụ làm việc trước, hiệu ứng sau.** Admin và app môi giới là công cụ dùng hằng ngày: ưu tiên rõ ràng, mật độ thông tin, tốc độ. Animation (Magic UI, Aceternity, React Bits) chỉ dùng có chủ đích: login, empty state, số liệu dashboard, onboarding. Không dùng cho bảng, form, CRUD.
5. **Accessible mặc định.** WCAG 2.2 AA: tương phản được kiểm tra tự động trong `npm run check`, điều khiển được bằng bàn phím, focus thấy rõ, vùng chạm ≥ 44px, tôn trọng `prefers-reduced-motion`.
6. **Mọi màn hình có đủ 4 trạng thái:** loading, empty, error, có dữ liệu.
7. **Inspiration không phải để copy.** Mobbin, Dribbble, Behance, Land-book, Awwwards chỉ để tham khảo. Phân tích thành layout, component, interaction, typography, spacing, màu, behavior rồi dựng lại bằng token và component của project. Không sao chép UI, thương hiệu của Đại Thế Kỷ hay sản phẩm khác.

## Thứ tự ưu tiên nguồn

| #   | Nguồn                                   | Dùng cho                                         |
| --- | --------------------------------------- | ------------------------------------------------ |
| 1   | shadcn/ui                               | Component nền tảng (web)                         |
| 2   | Magic UI                                | Animation, interactive nhẹ                       |
| 3   | Aceternity UI                           | Hiệu ứng nâng cao (rất hạn chế trong admin)      |
| 4   | React Bits                              | Text/background animation                        |
| 5   | Tailark                                 | Section, layout kiểu SaaS (trang public nếu có)  |
| 6   | Material Design 3                       | Nguyên tắc + widget Flutter                      |
| 7   | Apple HIG                               | Nguyên tắc UX mobile, iOS                        |
| 8   | Atlassian Design System                 | Pattern UX cho công cụ nghiệp vụ (bảng, form...) |
| 9   | Mobbin, Dribbble, Behance, Land-book... | Chỉ inspiration                                  |

Chi tiết từng nguồn: [registries.md](registries.md).

## Quy trình mỗi yêu cầu UI

```text
Requirement → Phân tích UX → Kiểm tra component hiện có → Tìm registry → Chọn component
→ Reuse / customize → Responsive → Accessibility → Consistency → Implement → Test
→ Cập nhật component-inventory.md
```

Checklist đầy đủ nằm trong skill [`ui-system`][skill].

## Token: sửa thế nào

```bash
# 1. Sửa docs/design-system/tokens/tokens.json
npm run tokens:build   # sinh lại tokens.css + app_tokens.dart
npm run test:tokens    # test generator + tương phản WCAG
npm run check          # lint + format + typecheck + kiểm tra file sinh ra đã cập nhật
```

Khi app được khởi tạo, file sinh ra sẽ được dùng ở:

- Admin (TASK-100): nội dung `tokens.css` vào `admin/src/app/globals.css` (sau `@import "tailwindcss";`).
- Mobile (TASK-114 App theme): `app_tokens.dart` vào `mobile/lib/core/theme/`, `ThemeData` dựng từ `AppColorTokens.light/dark.toColorScheme()` và `AppTypography.textTheme`.

Lúc đó generator sẽ được trỏ thẳng tới hai đường dẫn này để không phải copy tay.

## Quyết định cần duyệt

Các giá trị dưới đây là **mặc định đề xuất**, đổi được bằng cách sửa `tokens.json`:

- Màu thương hiệu: xanh dương `#1D4ED8` (tin cậy, trung tính, khác màu nhận diện của các sàn BĐS lớn). Chưa có brand guideline.
- Font: **Be Vietnam Pro** (thiết kế cho dấu tiếng Việt, có trên Google Fonts, license OFL).
- Dark mode: token có sẵn cả light và dark; admin bật theo hệ thống, mobile theo `ThemeMode.system`.
- Dependency frontend (shadcn/ui, Tailwind v4, lucide-react...) sẽ đề xuất và xin duyệt ở TASK-100 / TASK-113, không cài trước.
