# Coding standards

## Công cụ

| Công cụ           | File cấu hình                             | Phạm vi                                                     |
| ----------------- | ----------------------------------------- | ----------------------------------------------------------- |
| EditorConfig      | `.editorconfig`                           | Mọi file: UTF-8, LF, thụt 2 dấu cách, dòng tối đa 100 ký tự |
| Git line endings  | `.gitattributes`                          | Ép LF trong repo, tránh lỗi CRLF trên Windows               |
| Prettier          | `.prettierrc.json`, `.prettierignore`     | JS/TS/JSON/YAML/Markdown (trừ `mobile/`)                    |
| ESLint            | `eslint.config.mjs`                       | JS/TS toàn repo (trừ `mobile/`)                             |
| TypeScript strict | `tsconfig.base.json`                      | Cấu hình dùng chung; `backend/`, `admin/` extends file này  |
| Dart/Flutter      | `analysis_options.yaml` (thêm ở TASK-113) | `mobile/`                                                   |

Lệnh ở thư mục gốc (cần `npm install` một lần):

```bash
npm run lint          # ESLint
npm run lint:fix      # ESLint tự sửa
npm run format        # Prettier ghi lại file
npm run format:check  # Prettier chỉ kiểm tra
npm run typecheck     # TypeScript
npm run check         # chạy cả ba, phải pass trước khi commit
```

## TypeScript strict

Bật `strict` cùng `noImplicitReturns`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. Không dùng `any` (ESLint báo lỗi); nếu bắt buộc phải dùng, ghi chú lý do ngay dòng đó.

## Quy ước đặt tên

### TypeScript / JavaScript (ESLint kiểm tra tự động)

| Loại                                 | Quy ước                | Ví dụ                                  |
| ------------------------------------ | ---------------------- | -------------------------------------- |
| Biến, hàm, tham số, method, property | camelCase              | `propertyCount`, `findById()`          |
| Hằng số cấp module                   | UPPER_SNAKE_CASE       | `MAX_PAGE_SIZE`                        |
| Class, interface, type, enum         | PascalCase             | `PropertyService`, `CreatePropertyDto` |
| Thành viên enum                      | UPPER_SNAKE_CASE       | `PropertyStatus.VERIFY_REQUIRED`       |
| Tham số không dùng                   | tiền tố `_`            | `_req`                                 |
| Interface                            | Không thêm tiền tố `I` | `Property`, không phải `IProperty`     |

### File và thư mục

| Loại                    | Quy ước                                   | Ví dụ                                                                          |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| File TS/JS              | kebab-case, có hậu tố vai trò theo NestJS | `property.service.ts`, `create-property.dto.ts`, `property.controller.spec.ts` |
| Component React (admin) | kebab-case                                | `property-table.tsx`                                                           |
| File Dart (mobile)      | snake_case                                | `property_detail_screen.dart`                                                  |
| Thư mục                 | kebab-case                                | `saved-searches/`                                                              |
| Script shell            | kebab-case                                | `setup-env.sh`                                                                 |

### Database (PostgreSQL)

| Loại       | Quy ước                     | Ví dụ                               |
| ---------- | --------------------------- | ----------------------------------- |
| Bảng       | snake_case, số nhiều        | `properties`, `customer_activities` |
| Cột        | snake_case                  | `tenant_id`, `created_at`           |
| Khoá chính | `id` (UUID)                 |                                     |
| Khoá ngoại | `<bảng số ít>_id`           | `property_id`, `agent_id`           |
| Index      | `idx_<bảng>_<cột>`          | `idx_properties_tenant_id_status`   |
| Unique     | `uq_<bảng>_<cột>`           | `uq_users_email`                    |
| Migration  | `<timestamp>-<mô-tả-kebab>` | `1759550000000-create-companies`    |

### API

| Loại         | Quy ước                      | Ví dụ                                       |
| ------------ | ---------------------------- | ------------------------------------------- |
| Đường dẫn    | kebab-case, danh từ số nhiều | `/properties`, `/saved-searches/:id`        |
| Field JSON   | camelCase                    | `{ "tenantId": "...", "createdAt": "..." }` |
| Giá trị enum | UPPER_SNAKE_CASE             | `"AVAILABLE"`                               |
| Permission   | `<module>.<hành động>`       | `property.create`, `customer.assign`        |

### Dart / Flutter

Theo [Effective Dart](https://dart.dev/effective-dart/style): class `UpperCamelCase`, biến và hàm `lowerCamelCase`, file và thư mục `snake_case`.

### Biến môi trường

UPPER_SNAKE_CASE: `DATABASE_URL`, `JWT_SECRET`. Xem `docs/environment.md`.

## Nguyên tắc code

- Ưu tiên code đơn giản, rõ ràng, dễ bảo trì; không tối ưu sớm.
- Không hard-code secret hay permission.
- Business logic quan trọng nằm ở backend (Controller → Service → Repository).
- Mọi API có validation; mọi truy vấn dữ liệu nghiệp vụ lọc theo `tenant_id`.
- Mọi thay đổi database đi qua migration.
- Code mới phải có test phù hợp và qua `npm run check` trước khi commit.
