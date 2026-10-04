# AI Real Estate OS

Hệ điều hành AI cho doanh nghiệp và môi giới bất động sản.

Một nền tảng giúp môi giới và công ty BĐS quản lý trọn quy trình trong một hệ thống: nguồn hàng BĐS, khách hàng (CRM), ghép khách với BĐS phù hợp, lịch dẫn khách, giao dịch, hoa hồng, đội nhóm, báo cáo, và AI hỗ trợ. Hệ thống được thiết kế multi-tenant ngay từ đầu: nhiều công ty dùng chung nền tảng, dữ liệu giữa các công ty được cô lập hoàn toàn.

## Cấu trúc thư mục

```text
.
├── mobile/     # Ứng dụng Flutter cho môi giới
├── backend/    # API NestJS
├── admin/      # Web quản trị Next.js
├── database/   # Thiết kế, migration, seed PostgreSQL
├── docs/       # Tài liệu dự án
├── scripts/    # Script hỗ trợ phát triển
├── .env.example
└── README.md
```

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Mobile | Flutter |
| Backend | NestJS |
| Admin | Next.js |
| Database | PostgreSQL + PostGIS |
| Lưu trữ ảnh | S3 / Cloudflare R2 |
| Thông báo đẩy | Firebase Cloud Messaging |
| Bản đồ | Google Maps |
| AI | LLM API, chỉ gọi qua backend |
| Hạ tầng | Docker, GitHub Actions |

## Nguyên tắc

- Mobile và Admin chỉ gọi Backend API, không truy cập database trực tiếp.
- Mọi business logic, phân quyền và cô lập dữ liệu giữa các công ty nằm ở backend.
- Không commit secret. Biến môi trường mẫu nằm trong `.env.example`.
- Mọi thay đổi database đi qua migration.

## Bắt đầu

Môi trường phát triển (Docker Compose, cấu hình biến môi trường) sẽ được bổ sung ở TASK-002 và TASK-003.

```bash
cp .env.example .env   # sau đó điền giá trị thật, không commit file .env
```

## Quy trình phát triển

Dự án được xây dựng tuần tự theo roadmap, mỗi lần một task:

READ → PLAN → IMPLEMENT → TEST → REVIEW → FIX → DOCUMENT → COMMIT
