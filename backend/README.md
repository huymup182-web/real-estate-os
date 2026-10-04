# backend

Backend API viết bằng NestJS 12 (TypeScript, ESM), kết nối PostgreSQL + PostGIS. Kiến trúc: modular monolith, mỗi nghiệp vụ một module NestJS.

## Cấu trúc

```text
backend/
├── src/
│   ├── main.ts            # điểm khởi động: đọc cấu hình, lắng nghe cổng
│   ├── app.factory.ts     # tạo app dùng chung cho main.ts và test (tiền tố /api/v1)
│   ├── app.module.ts      # module gốc; module nghiệp vụ thêm ở các task sau
│   ├── config/            # đọc và kiểm tra biến môi trường (AppConfigModule, token APP_CONFIG)
│   └── database/          # kết nối PostgreSQL qua TypeORM (DatabaseModule)
├── test/                  # test (node:test), chạy trên bản build trong .test-dist/
├── nest-cli.json
├── tsconfig.json          # extends ../tsconfig.base.json, bật decorator
└── tsconfig.build.json    # build production từ src/ ra dist/
```

## Lệnh

Chạy trong thư mục `backend/` sau `npm install`.

| Lệnh                | Tác dụng                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| `npm run start:dev` | Chạy dev, tự build lại khi sửa code                                     |
| `npm run build`     | Build ra `dist/`                                                        |
| `npm start`         | Chạy bản build (`node dist/main.js`)                                    |
| `npm test`          | Build vào `.test-dist/` rồi chạy `node:test` (cần PostgreSQL đang chạy) |

Lint, format, typecheck chạy chung ở thư mục gốc: `npm run check`.

Trong Docker (`docker compose up backend`), container tự `npm install` lần đầu rồi chạy `npm run start:dev`.

## Biến môi trường

| Biến           | Mặc định      | Kiểm tra                                       |
| -------------- | ------------- | ---------------------------------------------- |
| `PORT`         | `3000`        | Số nguyên 1–65535                              |
| `NODE_ENV`     | `development` | `development` \| `production` \| `test`        |
| `DATABASE_URL` | (bắt buộc)    | Dạng `postgresql://USER:PASSWORD@HOST:PORT/DB` |

Sai giá trị thì ứng dụng dừng ngay khi khởi động. Các biến khác (JWT_SECRET…) được dùng từ các task sau.

`npm run start:dev` và `npm test` tự đọc `../.env.development` rồi `../.env` (biến đã có trong môi trường được giữ nguyên). `npm start` (production) chỉ dùng biến môi trường.

## Database

- Kết nối bằng TypeORM (`src/database/database.module.ts`). Không dùng `synchronize`, không tự chạy migration: schema chỉ thay đổi qua migration trong `database/` (`cd database && npm run migration:run`).
- Không kết nối được thì thử lại 5 lần, mỗi lần cách 3 giây, rồi dừng ứng dụng.
- Kết nối đóng gọn khi ứng dụng tắt (SIGTERM).

Mọi API nằm dưới tiền tố `/api/v1` (phase0/05-API-CONVENTIONS.md).
