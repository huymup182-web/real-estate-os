# Triển khai production (TASK-160)

Huy Lê chọn "VPS + Docker" ngày 2026-10-10. Toàn bộ hệ thống chạy bằng Docker Compose trên một máy chủ, và Caddy tự cấp HTTPS. Image Docker dùng được ở nơi khác nếu sau này đổi hạ tầng.

Repo chỉ chứa cấu hình triển khai, không chứa secret. Chưa có máy chủ thật: các bước "lần đầu" dưới đây là việc cần làm khi có VPS và tên miền.

## Thành phần

```text
Internet ──443──> caddy ──> admin   (Next.js, admin.<tên miền>)
                    └────> backend (NestJS, api.<tên miền>) ──> postgres (PostGIS 16, volume postgres_data)
                                     │                      └─> S3/R2 ảnh, SMTP, LLM, FCM
App di động ───────────────────────────┘
cron máy chủ ──> backup (cùng image backend) ──> bucket sao lưu riêng
prometheus ──> backend /metrics, node-exporter ──> alertmanager ──> email
```

| Service                                                              | Image                             | Ghi chú                                                                      |
| -------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `postgres`                                                           | `postgis/postgis:16-3.4`          | Không mở cổng ra ngoài. Dữ liệu ở volume `real-estate-os-prod_postgres_data` |
| `backend`                                                            | `real-estate-os-backend:<commit>` | Một instance (xem "Giới hạn"). `TRUST_PROXY_HOPS=1` vì chạy sau Caddy        |
| `admin`                                                              | `real-estate-os-admin:<commit>`   | Bản standalone của Next.js, `APP_VERSION` = commit                           |
| `caddy`                                                              | `caddy:2.10-alpine`               | Cổng 80/443, HTTPS Let's Encrypt, nén, chặn `/api/v1/metrics` từ Internet    |
| `migrate` (profile `tools`)                                          | `real-estate-os-migrate:<commit>` | `docker compose run --rm migrate run`                                        |
| `backup` (profile `tools`)                                           | image backend                     | `docker compose run --rm backup create` ([backup.md](backup.md))             |
| `prometheus`, `alertmanager`, `node-exporter` (profile `monitoring`) | `prom/*`                          | Số liệu và cảnh báo ([monitoring.md](monitoring.md))                         |

Image do workflow **Release** build và đẩy lên GitHub Container Registry (`ghcr.io/huymup182-web/real-estate-os-*`). Mỗi image có tag là commit git và `latest`.

## Cần chuẩn bị

- **VPS**: Ubuntu 24.04, 4 vCPU, 8 GB RAM, 80 GB SSD. Cấu hình này đủ cho tải đã đo: khoảng 42 request/giây với 50 người dùng cùng lúc ([load-testing.md](load-testing.md)). Cài Docker Engine và plugin Compose. Tường lửa chỉ mở 22, 80, 443.
- **Tên miền**: hai bản ghi A (và AAAA nếu có IPv6) trỏ về VPS, ví dụ `api.ten-mien.vn` và `admin.ten-mien.vn`.
- **Dịch vụ ngoài**:
  - SMTP gửi email.
  - Bucket ảnh S3/R2 ([environment.md](environment.md)).
  - Bucket sao lưu riêng, tốt nhất ở tài khoản khác.
  - Tùy chọn: khoá AI và Firebase.
- **Giám sát từ bên ngoài**:
  - Một dịch vụ uptime check gọi `https://api.<tên miền>/api/v1/health` và `https://admin.<tên miền>/login` mỗi phút.
  - Một heartbeat cho sao lưu (`BACKUP_HEARTBEAT_URL`, [monitoring.md](monitoring.md)).

## Lần đầu trên máy chủ

```bash
# 1. User riêng cho việc triển khai, chỉ đăng nhập bằng SSH key
sudo adduser --disabled-password deploy && sudo usermod -aG docker deploy
sudo mkdir -p /opt/real-estate-os/deploy && sudo chown -R deploy: /opt/real-estate-os

# 2. Chép thư mục deploy/ của repo lên (workflow Deploy cũng tự chép mỗi lần chạy)
scp -r deploy/* deploy@<vps>:/opt/real-estate-os/deploy/

# 3. Trên máy chủ, trong /opt/real-estate-os/deploy
cp env.example .env                          # IMAGE_TAG, tên miền, email Let's Encrypt
cp production.env.example production.env     # điền secret, chmod 600
chmod 600 production.env
mkdir -p secrets && openssl rand -hex 32 > secrets/metrics_token   # cùng giá trị METRICS_TOKEN
cp alertmanager/alertmanager.example.yml alertmanager/alertmanager.yml   # điền SMTP, người nhận

# 4. Lần đầu database trống nên bỏ sao lưu
echo <token đọc package GHCR> | docker login ghcr.io -u <github user> --password-stdin
SKIP_BACKUP=1 ./deploy.sh <commit>

# 5. Lịch sao lưu
crontab -e    # dán deploy/crontab.example (sửa đường dẫn nếu khác)
```

Sau bước 4, mở `https://admin.<tên miền>`. Công ty đầu tiên đăng ký qua `POST /api/v1/auth/register` (app di động hoặc API). Không chạy `seed` dữ liệu demo ở production.

## GitHub

- **CI** (`.github/workflows/ci.yml`) chạy với mỗi pull request và mỗi lần push lên `main`:
  - lint, format, typecheck;
  - test database và backend với PostgreSQL thật;
  - test và build admin;
  - format, analyze, test mobile;
  - build 3 image.
- **Release** (`release.yml`): khi merge vào `main`, build và đẩy image lên GHCR bằng `GITHUB_TOKEN`, không cần secret thêm.
- **Deploy** (`deploy.yml`) chỉ chạy tay: Actions → Deploy → Run workflow, nhập commit hoặc để trống.
  - Workflow chép `deploy/` lên máy chủ và đăng nhập GHCR bằng token tạm của job, rồi chạy `deploy.sh`.
  - Cần tạo environment `production` (Settings → Environments) gồm:
    - secret `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (khoá riêng của user `deploy`);
    - secret `DEPLOY_KNOWN_HOSTS` (kết quả `ssh-keyscan <vps>`);
    - biến `DEPLOY_PATH` (`/opt/real-estate-os`).
  - Nên bật "Required reviewers" để mỗi lần triển khai cần người duyệt.

## Mỗi lần phát hành

1. Merge pull request vào `main`, chờ CI và Release xanh.
2. Chạy workflow Deploy với commit vừa merge. `deploy.sh` chạy lần lượt:
   1. Kéo image.
   2. Sao lưu database.
   3. Chạy migration.
   4. Khởi động lại backend, admin, Caddy và chờ health check khỏe.
   5. Bật giám sát nếu đã có cấu hình.
      Lỗi ở bước nào thì dừng ở bước đó.
3. Kiểm tra nhanh: đăng nhập admin, xem `docker compose ps`, xem log lỗi (`docker compose logs --since 10m backend | grep '"level":"error"'`).

Mỗi lần triển khai backend khởi động lại, nên mất kết nối vài giây. Nên triển khai ngoài giờ làm việc.

## Quay lại bản trước

- Chạy Deploy (hoặc `./deploy.sh <commit cũ>` trên máy chủ) với commit trước đó. `deploy.sh` in ra commit trước khi đổi.
- Migration chỉ chạy tiến. Code cũ vẫn chạy được với schema mới khi migration chỉ thêm bảng, thêm cột. Nếu migration đổi hoặc xoá dữ liệu thì không tự revert. Khôi phục bản sao lưu vừa tạo trước migration theo [backup.md](backup.md) (khôi phục vào database mới rồi đổi `DATABASE_URL`).

## App di động

Build trên máy có Flutter (Android) hoặc macOS (iOS), trỏ vào API production:

```bash
flutter build appbundle --release \
  --dart-define=ENV=production \
  --dart-define=API_BASE_URL=https://api.<tên miền> \
  --dart-define=APP_VERSION=1.0.0+1
```

- Android cần khoá ký release: `android/key.properties` và file `.jks`. Cả hai đã nằm trong `.gitignore`, không commit, và cần giữ bản sao an toàn vì mất khoá thì không cập nhật được app trên Google Play.
- iOS: `flutter build ipa` với cùng `--dart-define`, ký bằng tài khoản Apple Developer.
- Chưa có workflow phát hành app lên store. Cần tài khoản Google Play Console, Apple Developer và khoá ký của bạn.

## Bảo mật máy chủ

- SSH chỉ bằng key, tắt đăng nhập root và mật khẩu (`/etc/ssh/sshd_config`).
- Bật `unattended-upgrades` để tự cập nhật bản vá bảo mật.
- `production.env`, `secrets/`, `alertmanager/alertmanager.yml` để quyền `600`. Chúng không có trong git và image.
- PostgreSQL, Prometheus, Alertmanager không mở cổng ra ngoài. Xem Prometheus qua SSH tunnel: `ssh -L 9090:localhost:9090` rồi `docker compose exec prometheus` hoặc thêm `ports: ['127.0.0.1:9090:9090']`.
- Đổi secret (`JWT_SECRET` làm mọi phiên đăng nhập hết hạn): sửa `production.env` rồi `docker compose up -d backend`.

## Giới hạn

- **Một instance backend.** Giới hạn số lần gọi (TASK-155) đếm trong bộ nhớ từng instance, và job định kỳ chạy trên mọi instance. Muốn chạy nhiều instance thì cần store chung (Redis) cho giới hạn và khoá (advisory lock) cho job ([security-audit.md](security-audit.md)).
- Database chung máy với ứng dụng. Khi tải tăng hoặc cần khôi phục theo thời điểm (point-in-time recovery), chuyển sang PostgreSQL quản lý: chỉ đổi `DATABASE_URL`, bỏ service `postgres`.
- Source map của admin không được công khai. Stack lỗi trình duyệt là code đã nén ([crash-reporting.md](crash-reporting.md)).

## Đã kiểm tra

Trong môi trường cloud của Claude ngày 2026-10-10:

- Build 3 image, chạy `deploy.sh` với Caddy (tên miền `*.localhost`, chứng chỉ nội bộ) và S3 giả, rồi kiểm tra:
  - HTTPS trả 200 cho API và admin, HTTP chuyển sang HTTPS, `/api/v1/metrics` từ ngoài trả 404.
  - Đăng ký công ty, đăng nhập admin bằng trình duyệt, báo cáo lỗi về backend kèm `APP_VERSION`.
  - `backup create` gửi lên kho, `backup check` khôi phục được 34 bảng.
  - Prometheus đọc được backend và node-exporter, nạp 11 luật cảnh báo, Alertmanager sẵn sàng.
  - Chạy `deploy.sh` lần hai trên dữ liệu có sẵn.
- Môi trường đó chặn kho gói Alpine. Vì vậy bước `apk add` (`postgresql16-client`, `tini`) chỉ chạy trong CI (job "Build image Docker") và trên máy chủ; bản thử thay bằng file của image `postgres:16-alpine`.
- `actionlint` và `shellcheck` không báo lỗi, `caddy validate`, `promtool check rules` và `amtool check-config` đều qua.

## File

- `backend/Dockerfile`, `admin/Dockerfile`, `database/Dockerfile`: image production, chạy bằng user `node`.
- `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/deploy.sh`, `deploy/env.example`, `deploy/production.env.example`, `deploy/crontab.example`.
- `deploy/prometheus/prometheus.yml`, `deploy/prometheus/alerts.yml`, `deploy/alertmanager/alertmanager.example.yml`.
- `.github/workflows/ci.yml`, `release.yml`, `deploy.yml`.
