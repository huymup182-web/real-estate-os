# Database architecture

> TASK-006. Thiết kế database cho toàn hệ thống. Chưa có migration hay code API: các bảng được tạo lần lượt ở TASK-007 → TASK-025, index ở TASK-026, dữ liệu demo ở TASK-027.
>
> Sơ đồ quan hệ: [erd.png](erd.png) (nguồn: [erd.dot](erd.dot), tạo lại bằng `sh scripts/generate-erd.sh`).

## 1. Công nghệ

- PostgreSQL 16 + PostGIS 3.4 (image `postgis/postgis:16-3.4` trong `docker-compose.yml`).
- Extension: `postgis` (toạ độ, tìm theo bán kính/khung bản đồ), `pg_trgm` (tìm gần đúng, phát hiện trùng), `unaccent` (tìm tiếng Việt không dấu), `citext` (email không phân biệt hoa thường).
- ORM và migration: TypeORM. Migration nằm trong `database/migrations/` (xem `database/README.md`), backend dùng lại cùng bộ migration. Mọi thay đổi schema đi qua migration, không dùng `synchronize`.
- Cột `updated_at` được trigger `set_updated_at()` tự cập nhật ở mọi bảng có cột này.

### Hàm hỗ trợ

`unaccent()` của PostgreSQL không phải hàm `IMMUTABLE` nên không dùng trực tiếp được trong cột GENERATED hay index. Migration đầu tiên tạo hàm bọc:

```sql
CREATE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
```

Tìm kiếm dùng cấu hình `simple` (không stemming) vì PostgreSQL không có từ điển tiếng Việt; bỏ dấu ở cả dữ liệu lẫn từ khoá nên gõ “vinh hai” vẫn ra “Vĩnh Hải”.

## 2. Quy ước

| Quy ước                      | Chi tiết                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tên                          | Bảng `snake_case` số nhiều, cột `snake_case` (xem `docs/coding-standards.md`)                                                                                                     |
| Khoá chính                   | `id uuid DEFAULT gen_random_uuid()`                                                                                                                                               |
| Multi-tenant                 | Mọi bảng nghiệp vụ có `tenant_id uuid NOT NULL REFERENCES companies(id)`. `tenant_id` lấy từ token đăng nhập, không bao giờ từ dữ liệu client gửi lên                             |
| Chống tham chiếu chéo tenant | Bảng cha có `UNIQUE (tenant_id, id)`; bảng con tham chiếu bằng khoá ngoại kép `(tenant_id, parent_id)`. Database tự chặn việc gắn bản ghi của công ty A vào bản ghi của công ty B |
| Thời gian                    | `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`, lưu UTC                                                                                                            |
| Soft delete                  | `deleted_at timestamptz NULL` ở bảng nghiệp vụ chính. Truy vấn mặc định lọc `deleted_at IS NULL`. Unique index dùng điều kiện `WHERE deleted_at IS NULL`                          |
| Người tạo/sửa                | `created_by`, `updated_by uuid NULL REFERENCES users(id)` ở bảng nghiệp vụ chính                                                                                                  |
| Tiền                         | `bigint`, đơn vị đồng (VND). Không dùng số thực                                                                                                                                   |
| Diện tích, chiều rộng        | `numeric(12,2)` (m²), `numeric(6,2)` (m)                                                                                                                                          |
| Trạng thái/enum              | `varchar` + `CHECK (... IN (...))`, giá trị UPPER_SNAKE_CASE                                                                                                                      |
| Dữ liệu mở rộng              | `jsonb` chỉ cho dữ liệu không cần lọc/ràng buộc (cài đặt, metadata)                                                                                                               |
| Transaction                  | Thao tác ghi nhiều bảng (tạo BĐS kèm ảnh, chốt deal kèm hoa hồng) chạy trong một transaction                                                                                      |

Ký hiệu trong tài liệu: `PK` khoá chính, `FK` khoá ngoại, `UQ` unique, `T-FK` khoá ngoại kép kèm `tenant_id`.

## 3. Nhóm bảng

| Nhóm                    | Bảng                                                                                                    | Task tạo       |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| Tổ chức                 | `companies`, `departments`, `teams`, `team_members`                                                     | 007, 011, 012  |
| Người dùng & phân quyền | `users`, `roles`, `user_roles`, `permissions`, `role_permissions`                                       | 008, 009, 010  |
| Địa giới hành chính     | `provinces`, `districts`, `wards`                                                                       | 013            |
| BĐS                     | `owners`, `properties`, `property_images`, `property_documents`, `property_favorites`, `property_views` | 014 → 017, 020 |
| Khách hàng (CRM)        | `customers`, `customer_preferences`, `customer_activities`                                              | 018, 019       |
| Tìm kiếm                | `saved_searches`                                                                                        | 021            |
| Lịch hẹn & giao dịch    | `appointments`, `deals`, `commissions`                                                                  | 022, 023       |
| Thông báo               | `notifications`                                                                                         | 024            |
| Audit                   | `audit_logs`                                                                                            | 025            |
| Xác thực (Phase 3)      | `refresh_tokens`, `password_reset_tokens`                                                               | 040, 042       |
| Thiết bị (Phase 8)      | `device_tokens`                                                                                         | 094            |

`user_roles` không có tên riêng trong roadmap nhưng bắt buộc để gán role cho user (một user có thể nhiều role); tạo cùng TASK-009. Ba bảng xác thực/thiết bị được thiết kế ở đây để ERD đầy đủ, nhưng chỉ tạo ở task tương ứng.

## 4. Chi tiết bảng

### 4.1 Tổ chức

**companies** (= tenant). Không có `tenant_id`; `id` của bảng này chính là tenant.

| Cột                                | Kiểu         | Ràng buộc                                                  |
| ---------------------------------- | ------------ | ---------------------------------------------------------- |
| id                                 | uuid         | PK                                                         |
| name                               | varchar(255) | NOT NULL                                                   |
| slug                               | varchar(100) | NOT NULL, UQ (khi chưa xoá), chữ thường-kebab              |
| status                             | varchar(20)  | NOT NULL, `ACTIVE` \| `SUSPENDED`, mặc định `ACTIVE`       |
| settings                           | jsonb        | NOT NULL DEFAULT `'{}'` (vd số ngày phải xác minh lại BĐS) |
| created_at, updated_at, deleted_at | timestamptz  |                                                            |

**departments**

| Cột                                | Kiểu         | Ràng buộc                                   |
| ---------------------------------- | ------------ | ------------------------------------------- |
| id                                 | uuid         | PK                                          |
| tenant_id                          | uuid         | NOT NULL, FK companies                      |
| name                               | varchar(255) | NOT NULL, UQ (tenant_id, name) khi chưa xoá |
| manager_id                         | uuid         | NULL, T-FK users                            |
| created_at, updated_at, deleted_at | timestamptz  |                                             |

Xoá cứng phòng ban còn user, hoặc xoá cứng user đang là trưởng phòng, bị chặn (`ON DELETE RESTRICT`); phòng ban dùng soft delete.

**teams**

| Cột                                | Kiểu         | Ràng buộc                                                  |
| ---------------------------------- | ------------ | ---------------------------------------------------------- |
| id                                 | uuid         | PK                                                         |
| tenant_id                          | uuid         | NOT NULL, FK companies                                     |
| department_id                      | uuid         | NOT NULL, T-FK departments                                 |
| name                               | varchar(255) | NOT NULL, UQ (tenant_id, department_id, name) khi chưa xoá |
| leader_id                          | uuid         | NULL, T-FK users                                           |
| created_at, updated_at, deleted_at | timestamptz  |                                                            |

**team_members**

| Cột       | Kiểu        | Ràng buộc              |
| --------- | ----------- | ---------------------- |
| tenant_id | uuid        | NOT NULL, FK companies |
| team_id   | uuid        | T-FK teams             |
| user_id   | uuid        | T-FK users             |
| joined_at | timestamptz | NOT NULL DEFAULT now() |
|           |             | PK (team_id, user_id)  |

Một user thuộc được nhiều team. Xoá cứng team hoặc user thì xoá luôn dòng thành viên (`ON DELETE CASCADE`); xoá cứng phòng ban còn team, hoặc user đang là trưởng nhóm, bị chặn (`ON DELETE RESTRICT`).

### 4.2 Người dùng & phân quyền

**users**

| Cột                                | Kiểu         | Ràng buộc                                                        |
| ---------------------------------- | ------------ | ---------------------------------------------------------------- |
| id                                 | uuid         | PK                                                               |
| tenant_id                          | uuid         | NULL, FK companies. Chỉ SUPER_ADMIN của nền tảng có `NULL`       |
| email                              | citext       | NULL, UQ toàn hệ thống khi chưa xoá                              |
| phone                              | varchar(20)  | NULL, UQ toàn hệ thống khi chưa xoá, lưu dạng chuẩn hoá `+84...` |
| password_hash                      | varchar(255) | NOT NULL (không bao giờ lưu mật khẩu gốc)                        |
| full_name                          | varchar(255) | NOT NULL                                                         |
| avatar_url                         | text         | NULL                                                             |
| department_id                      | uuid         | NULL, T-FK departments                                           |
| status                             | varchar(20)  | NOT NULL, `ACTIVE` \| `INACTIVE` \| `LOCKED`                     |
| last_login_at                      | timestamptz  | NULL                                                             |
| created_at, updated_at, deleted_at | timestamptz  |                                                                  |
|                                    |              | CHECK (email IS NOT NULL OR phone IS NOT NULL)                   |

Email/SĐT duy nhất toàn hệ thống để đăng nhập không cần nhập mã công ty (quyết định Q4 ở Phase 0). SĐT lưu dạng chuẩn `+` và 8–15 chữ số (vd `+84901234567`); email phải có dạng `x@y.z`. Cột `department_id` được thêm ở TASK-011 khi có bảng `departments`; user nền tảng (`tenant_id` NULL) không có phòng ban. Xoá cứng công ty còn user bị chặn (`ON DELETE RESTRICT`).

**roles**

| Cột                                | Kiểu         | Ràng buộc                                                    |
| ---------------------------------- | ------------ | ------------------------------------------------------------ |
| id                                 | uuid         | PK                                                           |
| tenant_id                          | uuid         | NULL, FK companies. `NULL` = role cấp nền tảng (SUPER_ADMIN) |
| code                               | varchar(50)  | NOT NULL, UQ (tenant_id, code). vd `AGENT`                   |
| name                               | varchar(100) | NOT NULL                                                     |
| description                        | text         | NULL                                                         |
| is_system                          | boolean      | NOT NULL DEFAULT false. Role mặc định: không xoá được        |
| created_at, updated_at, deleted_at | timestamptz  |                                                              |

Role mặc định (SUPER_ADMIN, COMPANY_ADMIN, DIRECTOR, MANAGER, TEAM_LEADER, AGENT, COLLABORATOR) được tạo cho mỗi công ty khi công ty được tạo; công ty có thể tạo thêm role riêng.

**user_roles**

| Cột        | Kiểu        | Ràng buộc                                                          |
| ---------- | ----------- | ------------------------------------------------------------------ |
| user_id    | uuid        | FK users                                                           |
| role_id    | uuid        | FK roles                                                           |
| tenant_id  | uuid        | NULL, FK companies (trùng tenant của user và role, kiểm ở service) |
| created_at | timestamptz |                                                                    |
|            |             | PK (user_id, role_id)                                              |

**permissions** (danh mục chung toàn hệ thống, tạo bằng migration seed, không có `tenant_id`)

| Cột         | Kiểu         | Ràng buộc                                              |
| ----------- | ------------ | ------------------------------------------------------ |
| id          | uuid         | PK                                                     |
| code        | varchar(100) | NOT NULL, UQ. vd `property.create`                     |
| module      | varchar(50)  | NOT NULL. vd `property`                                |
| description | text         | NOT NULL                                               |
| is_platform | boolean      | NOT NULL DEFAULT false. Chỉ gán được cho role nền tảng |
| created_at  | timestamptz  |                                                        |

**role_permissions**

| Cột           | Kiểu        | Ràng buộc                                                            |
| ------------- | ----------- | -------------------------------------------------------------------- |
| role_id       | uuid        | FK roles                                                             |
| permission_id | uuid        | FK permissions                                                       |
| scope         | varchar(20) | NOT NULL, `OWN` \| `TEAM` \| `DEPARTMENT` \| `COMPANY` \| `PLATFORM` |
|               |             | PK (role_id, permission_id)                                          |

`scope` quyết định phạm vi dữ liệu: của mình, của team, của phòng ban, toàn công ty, hay toàn nền tảng. Quyền không bao giờ hard-code trong code.

Ràng buộc (trigger `check_role_permissions_scope`): role nền tảng chỉ dùng scope `PLATFORM`; role công ty không được có scope `PLATFORM` hay quyền `is_platform`. Xoá cứng role thì xoá luôn quyền của role đó; permission đang được gán thì không xoá được.

Danh mục quyền MVP (seed trong migration TASK-010, `module` = phần trước dấu chấm đầu tiên):

| Module             | Permission                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| property           | `property.view`, `property.create`, `property.edit`, `property.delete`, `property.approve`, `property.view_owner_contact`, `property.verify`, `property.view_documents` |
| customer           | `customer.view`, `customer.create`, `customer.edit`, `customer.assign`, `customer.delete`                                                                               |
| user, team, report | `user.view`, `user.manage`, `team.view`, `team.manage`, `report.view`                                                                                                   |
| admin, audit       | `admin.manage`, `audit.view`                                                                                                                                            |
| appointment        | `appointment.view`, `appointment.manage`                                                                                                                                |
| deal, commission   | `deal.view`, `deal.manage`, `commission.view`, `commission.manage`                                                                                                      |
| platform           | `platform.company.manage` (`is_platform = true`)                                                                                                                        |

Quyền của từng role mặc định (ma trận trong RBAC) chưa được seed ở bảng này; sẽ tạo cùng role mặc định khi tạo công ty / seed TASK-027.

### 4.3 Địa giới hành chính

Dữ liệu dùng chung cho mọi công ty, không có `tenant_id`, không soft delete.

Từ 01/07/2025 Việt Nam bỏ cấp quận/huyện (còn tỉnh → xã/phường). Roadmap yêu cầu đủ 3 bảng, nên thiết kế giữ `districts` cho địa chỉ cũ nhưng không bắt buộc:

- `wards.province_id` bắt buộc, `wards.district_id` có thể `NULL` (phường/xã theo đơn vị mới).
- `is_active = false` đánh dấu đơn vị cũ đã sáp nhập, vẫn giữ để tìm theo tên quen thuộc.
- Khi phường/xã có `district_id`, quận/huyện phải cùng tỉnh (khoá ngoại kép `(province_id, district_id)`). Tỉnh hoặc quận/huyện đang được dùng thì không xoá được.
- Migration chỉ tạo bảng; danh sách đơn vị hành chính chính thức sẽ được nhập riêng.

**provinces**: `id` uuid PK · `code` varchar(10) NOT NULL UQ · `name` varchar(100) NOT NULL · `is_active` boolean NOT NULL DEFAULT true · `created_at`, `updated_at`.

**districts**: `id` uuid PK · `province_id` uuid NOT NULL FK provinces · `code` varchar(10) NOT NULL UQ · `name` varchar(100) NOT NULL · `is_active` boolean · `created_at`, `updated_at`.

**wards**: `id` uuid PK · `province_id` uuid NOT NULL FK provinces · `district_id` uuid NULL FK districts · `code` varchar(10) NOT NULL UQ · `name` varchar(100) NOT NULL · `is_active` boolean · `created_at`, `updated_at`.

### 4.4 BĐS

**owners** (chủ nhà; SĐT là dữ liệu nhạy cảm, chỉ người có quyền mới xem)

| Cột                                | Kiểu         | Ràng buộc                         |
| ---------------------------------- | ------------ | --------------------------------- |
| id                                 | uuid         | PK, UQ (tenant_id, id)            |
| tenant_id                          | uuid         | NOT NULL, FK companies            |
| full_name                          | varchar(255) | NOT NULL                          |
| phone                              | varchar(20)  | NOT NULL, dạng chuẩn hoá `+84...` |
| email                              | citext       | NULL                              |
| notes                              | text         | NULL                              |
| created_by, updated_by             | uuid         | FK users                          |
| created_at, updated_at, deleted_at | timestamptz  |                                   |

**properties**

| Cột                                | Kiểu                  | Ràng buộc                                                                                                                                                |
| ---------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                 | uuid                  | PK, UQ (tenant_id, id)                                                                                                                                   |
| tenant_id                          | uuid                  | NOT NULL, FK companies                                                                                                                                   |
| code                               | varchar(20)           | NOT NULL, UQ (tenant_id, code). Mã hiển thị, vd `BDS-000125`                                                                                             |
| title                              | varchar(255)          | NOT NULL                                                                                                                                                 |
| description                        | text                  | NULL                                                                                                                                                     |
| transaction_type                   | varchar(10)           | NOT NULL DEFAULT `SALE`, `SALE` \| `RENT` (MVP chỉ dùng `SALE`)                                                                                          |
| property_type                      | varchar(30)           | NOT NULL. Danh sách giá trị chốt ở TASK-014                                                                                                              |
| price                              | bigint                | NOT NULL, CHECK ≥ 0 (đồng)                                                                                                                               |
| area                               | numeric(12,2)         | NOT NULL, CHECK > 0 (m²)                                                                                                                                 |
| price_per_m2                       | bigint                | GENERATED `(price / NULLIF(area, 0))::bigint`, phục vụ thống kê                                                                                          |
| bedrooms, bathrooms, floors        | smallint              | NULL, CHECK ≥ 0                                                                                                                                          |
| direction                          | varchar(2)            | NULL, `N` `S` `E` `W` `NE` `NW` `SE` `SW`                                                                                                                |
| road_width                         | numeric(6,2)          | NULL, mét                                                                                                                                                |
| road_access                        | varchar(10)           | NULL, `CAR` \| `MOTORBIKE` \| `WALK` (phục vụ “ô tô vào được”)                                                                                           |
| legal_status                       | varchar(30)           | NULL. Danh sách giá trị chốt ở TASK-014                                                                                                                  |
| province_id                        | uuid                  | NOT NULL, FK provinces                                                                                                                                   |
| district_id                        | uuid                  | NULL, FK districts                                                                                                                                       |
| ward_id                            | uuid                  | NOT NULL, FK wards                                                                                                                                       |
| street_address                     | varchar(255)          | NULL. Địa chỉ chi tiết, chỉ người có quyền mới xem                                                                                                       |
| latitude, longitude                | numeric(9,6)          | NULL, cùng có hoặc cùng `NULL`                                                                                                                           |
| location                           | geography(Point,4326) | GENERATED `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography` (NULL nếu thiếu toạ độ), dùng cho bản đồ                                      |
| status                             | varchar(20)           | NOT NULL DEFAULT `AVAILABLE`: `AVAILABLE` `PENDING` `SOLD` `HIDDEN` `EXPIRED` `VERIFY_REQUIRED`                                                          |
| owner_id                           | uuid                  | NULL, T-FK owners                                                                                                                                        |
| agent_id                           | uuid                  | NOT NULL, T-FK users. Môi giới phụ trách                                                                                                                 |
| source                             | varchar(30)           | NULL. Nguồn hàng                                                                                                                                         |
| commission_type                    | varchar(10)           | NULL, `PERCENT` \| `FIXED`                                                                                                                               |
| commission_value                   | numeric(14,2)         | NULL, CHECK ≥ 0                                                                                                                                          |
| verification_status                | varchar(20)           | NOT NULL DEFAULT `UNVERIFIED`: `UNVERIFIED` `VERIFIED` `EXPIRED`                                                                                         |
| last_verified_at                   | timestamptz           | NULL                                                                                                                                                     |
| verified_by                        | uuid                  | NULL, T-FK users                                                                                                                                         |
| search_vector                      | tsvector              | GENERATED `to_tsvector('simple', immutable_unaccent(title \|\| ' ' \|\| description \|\| ' ' \|\| street_address))`, dùng cho Full Text Search không dấu |
| created_by, updated_by             | uuid                  | FK users                                                                                                                                                 |
| created_at, updated_at, deleted_at | timestamptz           |                                                                                                                                                          |

**property_images** (file nằm trên S3/R2, bảng chỉ lưu đường dẫn)

| Cột                    | Kiểu         | Ràng buộc                                                                      |
| ---------------------- | ------------ | ------------------------------------------------------------------------------ |
| id                     | uuid         | PK                                                                             |
| tenant_id              | uuid         | NOT NULL, FK companies                                                         |
| property_id            | uuid         | NOT NULL, T-FK properties                                                      |
| storage_key            | varchar(500) | NOT NULL. vd `{tenant_id}/properties/{property_id}/{id}.webp`                  |
| thumbnail_key          | varchar(500) | NULL                                                                           |
| mime_type              | varchar(50)  | NOT NULL                                                                       |
| size_bytes             | integer      | NOT NULL, CHECK > 0                                                            |
| width, height          | integer      | NULL                                                                           |
| sort_order             | integer      | NOT NULL DEFAULT 0                                                             |
| is_cover               | boolean      | NOT NULL DEFAULT false. Tối đa một ảnh bìa mỗi BĐS (unique index có điều kiện) |
| created_by             | uuid         | FK users                                                                       |
| created_at, deleted_at | timestamptz  |                                                                                |

**property_documents** (giấy tờ pháp lý, quyền xem chặt hơn ảnh)

| Cột                    | Kiểu         | Ràng buộc                 |
| ---------------------- | ------------ | ------------------------- |
| id                     | uuid         | PK                        |
| tenant_id              | uuid         | NOT NULL, FK companies    |
| property_id            | uuid         | NOT NULL, T-FK properties |
| document_type          | varchar(30)  | NOT NULL                  |
| file_name              | varchar(255) | NOT NULL                  |
| storage_key            | varchar(500) | NOT NULL                  |
| mime_type              | varchar(50)  | NOT NULL                  |
| size_bytes             | integer      | NOT NULL, CHECK > 0       |
| created_by             | uuid         | FK users                  |
| created_at, deleted_at | timestamptz  |                           |

**property_favorites**: `tenant_id` NOT NULL · `user_id` T-FK users · `property_id` T-FK properties · `created_at` · PK (user_id, property_id).

**property_views** (lượt xem chi tiết, chỉ thêm, không sửa): `id` PK · `tenant_id` NOT NULL · `property_id` T-FK properties · `user_id` T-FK users · `viewed_at` timestamptz NOT NULL DEFAULT now().

### 4.5 Khách hàng (CRM)

**customers**

| Cột                                | Kiểu         | Ràng buộc                                                                                            |
| ---------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| id                                 | uuid         | PK, UQ (tenant_id, id)                                                                               |
| tenant_id                          | uuid         | NOT NULL, FK companies                                                                               |
| full_name                          | varchar(255) | NOT NULL                                                                                             |
| phone                              | varchar(20)  | NOT NULL, dạng chuẩn hoá                                                                             |
| email                              | citext       | NULL                                                                                                 |
| purpose                            | varchar(20)  | NULL, `LIVING` \| `INVESTMENT` \| `RENT` \| `OTHER`                                                  |
| purchase_timeline                  | varchar(20)  | NULL, `IMMEDIATE` `WITHIN_3_MONTHS` `WITHIN_6_MONTHS` `OVER_6_MONTHS` `UNKNOWN`                      |
| source                             | varchar(30)  | NULL. Nguồn khách                                                                                    |
| agent_id                           | uuid         | NULL, T-FK users. Người phụ trách                                                                    |
| status                             | varchar(20)  | NOT NULL DEFAULT `NEW`: `NEW` `CONTACTED` `QUALIFIED` `VIEWING` `NEGOTIATING` `DEPOSIT` `WON` `LOST` |
| lost_reason                        | text         | NULL                                                                                                 |
| notes                              | text         | NULL                                                                                                 |
| created_by, updated_by             | uuid         | FK users                                                                                             |
| created_at, updated_at, deleted_at | timestamptz  |                                                                                                      |

**customer_preferences** (nhu cầu; một khách có thể nhiều nhu cầu, là đầu vào của matching)

| Cột                                  | Kiểu          | Ràng buộc                           |
| ------------------------------------ | ------------- | ----------------------------------- |
| id                                   | uuid          | PK                                  |
| tenant_id                            | uuid          | NOT NULL, FK companies              |
| customer_id                          | uuid          | NOT NULL, T-FK customers            |
| transaction_type                     | varchar(10)   | NOT NULL DEFAULT `SALE`             |
| property_types                       | varchar(30)[] | NULL                                |
| budget_min, budget_max               | bigint        | NULL, CHECK budget_min ≤ budget_max |
| area_min, area_max                   | numeric(12,2) | NULL                                |
| bedrooms_min                         | smallint      | NULL                                |
| province_ids, district_ids, ward_ids | uuid[]        | NULL. Khu vực mong muốn             |
| directions                           | varchar(2)[]  | NULL                                |
| legal_statuses                       | varchar(30)[] | NULL                                |
| min_road_access                      | varchar(10)   | NULL. vd `CAR` = cần ô tô vào được  |
| is_active                            | boolean       | NOT NULL DEFAULT true               |
| created_at, updated_at, deleted_at   | timestamptz   |                                     |

**customer_activities** (timeline; chỉ thêm, không sửa)

| Cột          | Kiểu        | Ràng buộc                                                                                                        |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| id           | uuid        | PK                                                                                                               |
| tenant_id    | uuid        | NOT NULL, FK companies                                                                                           |
| customer_id  | uuid        | NOT NULL, T-FK customers                                                                                         |
| user_id      | uuid        | NOT NULL, T-FK users. Người thực hiện                                                                            |
| type         | varchar(20) | NOT NULL: `CALL` `MESSAGE` `PROPERTY_SENT` `VIEWING` `NEGOTIATION` `DEPOSIT` `NOTE` `STATUS_CHANGE` `ASSIGNMENT` |
| content      | text        | NULL                                                                                                             |
| property_ids | uuid[]      | NULL. BĐS liên quan (vd đã gửi 5 căn)                                                                            |
| metadata     | jsonb       | NOT NULL DEFAULT `'{}'` (vd trạng thái cũ/mới)                                                                   |
| occurred_at  | timestamptz | NOT NULL DEFAULT now()                                                                                           |
| created_at   | timestamptz |                                                                                                                  |

### 4.6 Tìm kiếm

**saved_searches**: `id` PK · `tenant_id` NOT NULL · `user_id` T-FK users · `name` varchar(100) NOT NULL · `filters` jsonb NOT NULL (cùng cấu trúc bộ lọc của API tìm kiếm) · `notify` boolean NOT NULL DEFAULT true · `last_notified_at` timestamptz NULL · `created_at`, `updated_at`, `deleted_at`.

### 4.7 Lịch hẹn & giao dịch

**appointments** (lịch dẫn khách)

| Cột                                | Kiểu         | Ràng buộc                                                                   |
| ---------------------------------- | ------------ | --------------------------------------------------------------------------- |
| id                                 | uuid         | PK                                                                          |
| tenant_id                          | uuid         | NOT NULL, FK companies                                                      |
| customer_id                        | uuid         | NOT NULL, T-FK customers                                                    |
| property_id                        | uuid         | NOT NULL, T-FK properties                                                   |
| agent_id                           | uuid         | NOT NULL, T-FK users                                                        |
| scheduled_at                       | timestamptz  | NOT NULL                                                                    |
| duration_minutes                   | smallint     | NULL                                                                        |
| location                           | varchar(255) | NULL                                                                        |
| notes                              | text         | NULL                                                                        |
| status                             | varchar(20)  | NOT NULL DEFAULT `SCHEDULED`: `SCHEDULED` `COMPLETED` `CANCELLED` `NO_SHOW` |
| outcome                            | varchar(20)  | NULL: `INTERESTED` `NOT_INTERESTED` `NEED_FOLLOW_UP` `NEGOTIATING`          |
| reminder_sent_at                   | timestamptz  | NULL                                                                        |
| created_by, updated_by             | uuid         | FK users                                                                    |
| created_at, updated_at, deleted_at | timestamptz  |                                                                             |

**deals** (giao dịch)

| Cột                                | Kiểu        | Ràng buộc                                                                       |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| id                                 | uuid        | PK, UQ (tenant_id, id)                                                          |
| tenant_id                          | uuid        | NOT NULL, FK companies                                                          |
| customer_id                        | uuid        | NOT NULL, T-FK customers                                                        |
| property_id                        | uuid        | NOT NULL, T-FK properties                                                       |
| agent_id                           | uuid        | NOT NULL, T-FK users                                                            |
| stage                              | varchar(20) | NOT NULL DEFAULT `NEGOTIATING`: `NEGOTIATING` `DEPOSIT` `CONTRACT` `WON` `LOST` |
| deal_price                         | bigint      | NULL                                                                            |
| deposit_amount                     | bigint      | NULL                                                                            |
| deposit_at, closed_at              | timestamptz | NULL                                                                            |
| notes                              | text        | NULL                                                                            |
| created_by, updated_by             | uuid        | FK users                                                                        |
| created_at, updated_at, deleted_at | timestamptz |                                                                                 |

**commissions** (hoa hồng; một deal chia cho nhiều người)

| Cột                                | Kiểu         | Ràng buộc                                                           |
| ---------------------------------- | ------------ | ------------------------------------------------------------------- |
| id                                 | uuid         | PK                                                                  |
| tenant_id                          | uuid         | NOT NULL, FK companies                                              |
| deal_id                            | uuid         | NOT NULL, T-FK deals                                                |
| user_id                            | uuid         | NOT NULL, T-FK users. Người nhận                                    |
| role_in_deal                       | varchar(20)  | NOT NULL: `LISTING_AGENT` `SELLING_AGENT` `COLLABORATOR` `LEADER`   |
| amount                             | bigint       | NOT NULL, CHECK ≥ 0                                                 |
| percent                            | numeric(5,2) | NULL                                                                |
| status                             | varchar(20)  | NOT NULL DEFAULT `PENDING`: `PENDING` `APPROVED` `PAID` `CANCELLED` |
| paid_at                            | timestamptz  | NULL                                                                |
| created_at, updated_at, deleted_at | timestamptz  |                                                                     |

### 4.8 Thông báo

**notifications** (hộp thư trong app; push FCM chỉ là kênh gửi)

| Cột          | Kiểu         | Ràng buộc                                                                                                                                                |
| ------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | uuid         | PK                                                                                                                                                       |
| tenant_id    | uuid         | NULL, FK companies (`NULL` cho thông báo hệ thống tới SUPER_ADMIN)                                                                                       |
| user_id      | uuid         | NOT NULL, FK users. Người nhận                                                                                                                           |
| type         | varchar(30)  | NOT NULL: `NEW_PROPERTY` `PROPERTY_UPDATED` `MATCHED_PROPERTY` `CUSTOMER_ASSIGNED` `NEW_LEAD` `VIEWING_REMINDER` `VERIFY_REQUIRED` `SYSTEM_NOTIFICATION` |
| title        | varchar(255) | NOT NULL                                                                                                                                                 |
| body         | text         | NOT NULL                                                                                                                                                 |
| data         | jsonb        | NOT NULL DEFAULT `'{}'` (vd `{"propertyId": "..."}`)                                                                                                     |
| read_at      | timestamptz  | NULL                                                                                                                                                     |
| push_sent_at | timestamptz  | NULL                                                                                                                                                     |
| created_at   | timestamptz  |                                                                                                                                                          |

### 4.9 Audit

**audit_logs** (chỉ thêm; ứng dụng không được sửa/xoá)

| Cột         | Kiểu         | Ràng buộc                                                    |
| ----------- | ------------ | ------------------------------------------------------------ |
| id          | uuid         | PK                                                           |
| tenant_id   | uuid         | NULL, FK companies                                           |
| user_id     | uuid         | NULL, FK users                                               |
| action      | varchar(100) | NOT NULL. vd `property.update`, `auth.login`                 |
| entity_type | varchar(50)  | NULL                                                         |
| entity_id   | uuid         | NULL                                                         |
| changes     | jsonb        | NULL. `{field: [cũ, mới]}`, không bao giờ ghi mật khẩu/token |
| ip_address  | inet         | NULL                                                         |
| user_agent  | text         | NULL                                                         |
| request_id  | varchar(100) | NULL                                                         |
| created_at  | timestamptz  | NOT NULL DEFAULT now()                                       |

### 4.10 Xác thực và thiết bị (tạo ở Phase 3 và Phase 8)

**refresh_tokens** (mỗi dòng là một phiên đăng nhập): `id` PK · `user_id` FK users · `tenant_id` NULL · `token_hash` varchar(255) NOT NULL UQ (chỉ lưu hash) · `family_id` uuid NOT NULL (chuỗi xoay vòng token, thu hồi cả chuỗi khi phát hiện dùng lại) · `device_info` text · `ip_address` inet · `expires_at` NOT NULL · `revoked_at` NULL · `created_at`.

**password_reset_tokens**: `id` PK · `user_id` FK users · `token_hash` UQ · `expires_at` NOT NULL · `used_at` NULL · `created_at`.

**device_tokens** (FCM): `id` PK · `user_id` FK users · `tenant_id` NULL · `fcm_token` text NOT NULL UQ · `platform` `ANDROID` \| `IOS` \| `WEB` · `last_seen_at` · `created_at`.

## 5. Quan hệ chính

```text
companies 1──* departments 1──* teams *──* users (qua team_members)
companies 1──* users *──* roles (qua user_roles) *──* permissions (qua role_permissions + scope)
provinces 1──* districts, provinces 1──* wards, districts 1──* wards (tuỳ chọn)
users (agent) 1──* properties *──1 owners
properties *──1 provinces / districts / wards
properties 1──* property_images, property_documents, property_views, property_favorites
users (agent) 1──* customers 1──* customer_preferences, customer_activities
customers *──* properties qua appointments và deals
deals 1──* commissions *──1 users
users 1──* notifications, saved_searches, refresh_tokens, device_tokens
```

## 6. Chiến lược index (làm ở TASK-026)

Mọi index trên bảng nghiệp vụ bắt đầu bằng `tenant_id`, vì mọi truy vấn đều lọc theo công ty.

| Bảng                | Index                                                                 | Phục vụ                            |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| properties          | `(tenant_id, status, created_at DESC)` WHERE deleted_at IS NULL       | Danh sách mới nhất theo trạng thái |
| properties          | `(tenant_id, price)`, `(tenant_id, area)`                             | Lọc/sắp xếp theo giá, diện tích    |
| properties          | `(tenant_id, province_id, ward_id)`                                   | Lọc khu vực                        |
| properties          | `(tenant_id, agent_id)`                                               | BĐS của môi giới                   |
| properties          | GIST `(location)`                                                     | Bản đồ, tìm theo bán kính          |
| properties          | GIN `(search_vector)`                                                 | Full Text Search                   |
| properties          | `(tenant_id, last_verified_at)`                                       | Job đánh dấu `VERIFY_REQUIRED`     |
| customers           | `(tenant_id, agent_id, status)`                                       | Pipeline của môi giới              |
| customers           | `(tenant_id, phone)`                                                  | Tra trùng khách                    |
| customer_activities | `(tenant_id, customer_id, occurred_at DESC)`                          | Timeline                           |
| appointments        | `(tenant_id, agent_id, scheduled_at)`, `(tenant_id, customer_id)`     | Lịch, lịch sử khách                |
| deals               | `(tenant_id, agent_id, stage)`, `(tenant_id, customer_id)`            | Báo cáo, lịch sử khách             |
| notifications       | `(user_id, read_at, created_at DESC)`                                 | Hộp thư                            |
| audit_logs          | `(tenant_id, created_at DESC)`, `(tenant_id, entity_type, entity_id)` | Tra cứu audit                      |
| owners              | `(tenant_id, phone)`                                                  | Phát hiện trùng nguồn hàng         |

Index cụ thể sẽ được kiểm bằng `EXPLAIN ANALYZE` với dữ liệu demo trước khi chốt.

## 7. Kiểm chứng thiết kế

Các phần dễ sai đã được chạy thử trên PostgreSQL 16 + PostGIS 3.4 (container `postgres`):

- `price_per_m2` sinh đúng (5.000.000.000 đ / 62,5 m² = 80.000.000 đ/m²).
- `location` sinh đúng điểm từ latitude/longitude.
- `unaccent` trực tiếp trong cột GENERATED bị PostgreSQL từ chối (“generation expression is not immutable”), nên thiết kế dùng `immutable_unaccent`; tìm “vinh hai” khớp “Vĩnh Hải”.
- Khoá ngoại kép `(tenant_id, parent_id)` chặn gắn bản ghi sang công ty khác.

## 8. Ghi chú cho các task sau

- Thứ tự tạo bảng theo roadmap (TASK-007 → TASK-025) khớp với thứ tự phụ thuộc khoá ngoại; riêng các T-FK tới `users` trong `departments.manager_id`, `teams.leader_id` được thêm khi bảng `users` đã có.
- Danh sách giá trị cho `property_type`, `legal_status`, `source` sẽ chốt ở TASK-014/TASK-018 (cần anh xác nhận danh sách thực tế).
- Dữ liệu tỉnh/xã chuẩn được nạp ở TASK-013 từ danh mục hành chính chính thức.
