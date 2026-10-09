# admin

Web quản trị viết bằng Next.js 16 (App Router, React 19, TypeScript strict). Chỉ gọi Backend API, không truy cập database. Khởi tạo ở **TASK-100**; đăng nhập và các trang quản lý làm ở TASK-101..112.

## Chạy

```bash
cd admin
npm install
npm run dev        # http://localhost:3001
```

Trong Docker (`docker compose up`), container `admin` tự `npm install` lần đầu rồi chạy `npm run dev` ở cổng `3001`.

## Đăng nhập (TASK-101)

- Mọi trang trừ `/login` cần đăng nhập. `src/proxy.ts` chuyển người chưa đăng nhập tới `/login?next=<trang đang mở>`.
- Form đăng nhập là Server Action: phía server của admin gọi `POST /api/v1/auth/login`, rồi lưu token vào hai cookie HttpOnly. JavaScript trên trình duyệt không đọc được token.
  - `reos_access`: access token, SameSite=Lax, hết hạn sớm hơn token 30 giây.
  - `reos_refresh`: refresh token, SameSite=Strict, 30 ngày.
  - Cả hai bật `Secure` khi `NODE_ENV=production`.
- Hết access token mà còn refresh token: proxy gọi `POST /auth/refresh` và đặt cặp cookie mới. Các request đến cùng lúc với cùng refresh token dùng chung một lần gọi, vì backend coi việc dùng lại refresh token cũ là bị lộ và thu hồi cả phiên.
- Refresh bị từ chối: xoá cookie và về `/login`. Backend không trả lời được: giữ phiên, trang tự báo lỗi kết nối.
- Đăng xuất gọi `POST /auth/logout` rồi xoá cookie.
- Mọi tài khoản đang hoạt động đều đăng nhập được; menu sẽ ẩn/hiện theo permission. Kiểm quyền thật vẫn ở backend.

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
├── app/         # App Router: layout.tsx, page.tsx, login/, auth-actions.ts (Server Action đăng nhập/đăng xuất)
├── lib/         # backend.ts (gọi Backend API), auth/ (cookie phiên, đường dẫn, gọi API auth)
└── proxy.ts     # Chặn trang khi chưa đăng nhập, tự làm mới phiên
```
