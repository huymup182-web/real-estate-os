# Biến môi trường

## Các file

| File               | Commit?   | Mục đích                                                             |
| ------------------ | --------- | -------------------------------------------------------------------- |
| `.env.example`     | Có        | Mẫu đầy đủ các biến, không có giá trị nhạy cảm                       |
| `.env.development` | Có        | Giá trị mặc định cho dev local, **không chứa secret thật**           |
| `.env`             | **Không** | Giá trị riêng của từng máy và secret thật. Ghi đè `.env.development` |

Tạo `.env` lần đầu:

```bash
sh scripts/setup-env.sh   # copy .env.development và sinh JWT_SECRET ngẫu nhiên
sh scripts/check-env.sh   # kiểm tra đủ biến bắt buộc
```

Thứ tự ưu tiên trong Docker (sau ghi đè trước): `.env.development` → `.env` → giá trị khai báo trong `docker-compose.yml`. Riêng `DATABASE_URL` của container backend luôn trỏ tới host `postgres` trong network nội bộ.

## Danh sách biến

| Biến                                                 | Bắt buộc                                        | Dùng ở         | Mô tả                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                       | Có                                              | backend        | Chuỗi kết nối PostgreSQL `postgresql://USER:PASSWORD@HOST:PORT/DB`                                                                                         |
| `JWT_SECRET`                                         | Có                                              | backend        | Khoá ký JWT, chuỗi ngẫu nhiên ≥ 32 ký tự, khác nhau cho mỗi môi trường. Backend dừng nếu thiếu/ngắn, hoặc dùng khoá dev ở production                       |
| `STORAGE_BUCKET`                                     | Có ở production                                 | backend        | Bucket lưu ảnh BĐS (TASK-057). Ngoài production để trống thì không upload ảnh được                                                                         |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | Có khi đặt `STORAGE_BUCKET`                     | backend        | Khoá truy cập S3 / R2 / MinIO. Là secret: chỉ đặt trong `.env`/hệ thống triển khai                                                                         |
| `STORAGE_ENDPOINT`                                   | Với R2, MinIO                                   | backend        | Endpoint S3-compatible, vd `https://<account_id>.r2.cloudflarestorage.com`. Để trống với AWS S3                                                            |
| `STORAGE_REGION`, `STORAGE_FORCE_PATH_STYLE`         | Không (mặc định `auto`, `false`)                | backend        | Region AWS S3; `true` với MinIO                                                                                                                            |
| `STORAGE_PUBLIC_URL`                                 | Không                                           | backend        | Địa chỉ CDN đọc ảnh. Để trống thì backend cấp link đọc có hạn 1 giờ                                                                                        |
| `AI_API_KEY`                                         | Không                                           | backend        | Khoá API nhà cung cấp LLM cho AI gateway (TASK-133). Để trống thì tắt tính năng AI (API AI trả 503). Là secret, không bao giờ đưa vào mobile/admin         |
| `AI_PROVIDER`, `AI_MODEL`                            | Không (mặc định `anthropic`, `claude-opus-5-5`) | backend        | Nhà cung cấp LLM (hiện chỉ `anthropic`) và model gọi tới                                                                                                   |
| `AI_BASE_URL`                                        | Không (mặc định `https://api.anthropic.com`)    | backend        | Gốc URL API của nhà cung cấp LLM, đổi khi đi qua proxy                                                                                                     |
| `AI_TIMEOUT_MS`, `AI_USER_DAILY_LIMIT`               | Không (mặc định `60000`, `100`)                 | backend        | Thời gian chờ LLM (ms); số lượt AI tối đa của một người trong 24 giờ gần nhất                                                                              |
| `FCM_CONFIG`                                         | Không                                           | backend        | Service account Firebase (file JSON tải từ Firebase console), mã hoá base64. Để trống thì không đẩy thông báo; sai định dạng thì backend dừng. Là secret   |
| `NODE_ENV`                                           | Có                                              | backend, admin | `development` / `production` / `test`                                                                                                                      |
| `SMTP_HOST`                                          | Có ở production                                 | backend        | Máy chủ SMTP gửi email (mã đặt lại mật khẩu). Ngoài production để trống thì backend không gửi email. Dev: `localhost` (Mailpit), trong Docker là `mailpit` |
| `SMTP_PORT`, `SMTP_SECURE`                           | Không (mặc định `587`, `false`)                 | backend        | Cổng SMTP; `SMTP_SECURE=true` khi máy chủ dùng TLS ngay từ đầu (thường cổng 465)                                                                           |
| `SMTP_USER`, `SMTP_PASSWORD`                         | Khi máy chủ SMTP cần đăng nhập                  | backend        | Phải cùng có hoặc cùng để trống. Là secret: chỉ đặt trong `.env`/hệ thống triển khai                                                                       |
| `MAIL_FROM`                                          | Có khi đặt `SMTP_HOST`                          | backend        | Địa chỉ người gửi email                                                                                                                                    |
| `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`               | Không (mặc định `1025`, `8025`)                 | docker-compose | Cổng Mailpit (hộp thư giả cho dev). Xem email dev tại http://localhost:8025                                                                                |
| `LOG_LEVEL`                                          | Không (mặc định `log`)                          | backend        | Mức log: `fatal` / `error` / `warn` / `log` / `debug` / `verbose` (bật mức đã chọn và các mức nghiêm trọng hơn)                                            |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`  | Có (Docker)                                     | postgres       | Tài khoản database trong docker-compose                                                                                                                    |
| `POSTGRES_PORT`, `BACKEND_PORT`, `ADMIN_PORT`        | Không                                           | docker-compose | Cổng mở ra máy host                                                                                                                                        |
| `API_INTERNAL_URL`                                   | Không (mặc định `http://localhost:3000`)        | admin          | Gốc Backend API khi admin gọi từ phía server. docker-compose đặt `http://backend:3000`                                                                     |
| `SEED_DEMO_PASSWORD`                                 | Khi chạy `npm run seed`                         | database (dev) | Mật khẩu chung của tài khoản demo, ≥ 8 ký tự. Chỉ dùng ở dev                                                                                               |

## Quy tắc

- Không commit `.env` hay bất kỳ secret nào. `.gitignore` đã chặn `.env` và `.env.*` (trừ `.env.example`, `.env.development`).
- `AI_API_KEY`, `STORAGE_*`, `FCM_CONFIG` chỉ backend được đọc. Mobile và admin chỉ gọi Backend API.
- Môi trường staging/production đặt biến qua hệ thống triển khai (GitHub Actions secrets, biến môi trường server), không dùng file commit.
- Backend sẽ kiểm tra biến bắt buộc khi khởi động và dừng nếu thiếu (làm cùng TASK-028/TASK-029).
