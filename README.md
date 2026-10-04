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
├── docker-compose.yml
├── eslint.config.mjs   # ESLint dùng chung
├── tsconfig.base.json  # TypeScript strict dùng chung
├── .env.example
├── .env.development
└── README.md
```

## Công nghệ

| Thành phần    | Công nghệ                    |
| ------------- | ---------------------------- |
| Mobile        | Flutter                      |
| Backend       | NestJS                       |
| Admin         | Next.js                      |
| Database      | PostgreSQL + PostGIS         |
| Lưu trữ ảnh   | S3 / Cloudflare R2           |
| Thông báo đẩy | Firebase Cloud Messaging     |
| Bản đồ        | Google Maps                  |
| AI            | LLM API, chỉ gọi qua backend |
| Hạ tầng       | Docker, GitHub Actions       |

## Nguyên tắc

- Mobile và Admin chỉ gọi Backend API, không truy cập database trực tiếp.
- Mọi business logic, phân quyền và cô lập dữ liệu giữa các công ty nằm ở backend.
- Không commit secret. Biến môi trường mẫu nằm trong `.env.example`.
- Mọi thay đổi database đi qua migration.

## Môi trường phát triển (Docker)

Yêu cầu: Docker và Docker Compose v2.

```bash
sh scripts/setup-env.sh  # tạo .env (không commit), xem docs/environment.md
docker compose up        # thêm -d để chạy nền
```

| Service    | Mô tả                                                                 | Cổng host |
| ---------- | --------------------------------------------------------------------- | --------- |
| `postgres` | PostgreSQL 16 + PostGIS 3.4, dữ liệu lưu trong volume `postgres_data` | `5432`    |
| `backend`  | Container Node.js 22 cho NestJS API, mount thư mục `backend/`         | `3000`    |
| `admin`    | Container Node.js 22 cho Next.js admin, mount thư mục `admin/`        | `3001`    |

- Các service nói chuyện với nhau qua network nội bộ `internal`, gọi nhau bằng tên service (vd backend kết nối `postgres:5432`).
- Khi `backend/` hoặc `admin/` chưa có `package.json` (trước TASK-028 và TASK-100), container chạy một server giữ chỗ trả về `{"status":"placeholder"}`. Khi ứng dụng đã được khởi tạo, container tự `npm install` (lần đầu) rồi chạy `npm run start:dev` (backend) hoặc `npm run dev` (admin).
- Dừng: `docker compose down`. Xoá cả dữ liệu database: `docker compose down -v`.

## Chuẩn code

```bash
npm install      # cài ESLint, Prettier, TypeScript ở thư mục gốc
npm run check    # lint + format + typecheck, phải pass trước khi commit
```

Chi tiết và quy ước đặt tên: [docs/coding-standards.md](docs/coding-standards.md).

## Git workflow

Branch `main` / `develop` / `feature/*` / `fix/*`, commit theo Conventional Commits. Chi tiết: [docs/git-workflow.md](docs/git-workflow.md) và [CONTRIBUTING.md](CONTRIBUTING.md).

## Quy trình phát triển

Dự án được xây dựng tuần tự theo roadmap, mỗi lần một task:

READ → PLAN → IMPLEMENT → TEST → REVIEW → FIX → DOCUMENT → COMMIT
