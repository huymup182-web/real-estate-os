# admin

Web quản trị viết bằng Next.js 16 (App Router, React 19, TypeScript strict). Chỉ gọi Backend API, không truy cập database. Khởi tạo ở **TASK-100**; đăng nhập và các trang quản lý làm ở TASK-101..112.

## Chạy

```bash
cd admin
npm install
npm run dev        # http://localhost:3001
```

Trong Docker (`docker compose up`), container `admin` tự `npm install` lần đầu rồi chạy `npm run dev` ở cổng `3001`.

Trang chủ tạm gọi `GET /api/v1/health` của backend (phía server) và hiện backend có hoạt động không.

## Cấu hình

| Biến               | Mặc định                | Ý nghĩa                                                                         |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------- |
| `API_INTERNAL_URL` | `http://localhost:3000` | Gốc backend khi admin gọi từ phía server; trong Docker là `http://backend:3000` |

Admin không giữ secret nào (không đọc `JWT_SECRET`, `STORAGE_*`, `FCM_CONFIG`, `AI_API_KEY`).

## Lệnh

| Lệnh                | Việc                                                 |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Chạy dev, cổng 3001                                  |
| `npm run build`     | Build production (`.next/`)                          |
| `npm start`         | Chạy bản build, cổng 3001                            |
| `npm run typecheck` | Sinh type route (`next typegen`) rồi `tsc --noEmit`  |
| `npm test`          | Test đơn vị trong `src/**/*.test.ts` (`node --test`) |

Lint và format dùng cấu hình chung ở thư mục gốc (`npm run check`, đã gồm typecheck của admin).

## Cấu trúc

```text
src/
├── app/         # App Router: layout.tsx, page.tsx, globals.css
└── lib/         # Hàm dùng chung, vd backend.ts (URL và health check Backend API)
```
