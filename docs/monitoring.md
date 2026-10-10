# Giám sát hệ thống (TASK-158)

Mục tiêu là biết có sự cố trước người dùng: API ngừng chạy, lỗi tăng, chậm, database có vấn đề, job định kỳ hay sao lưu ngừng chạy. Code chỉ cung cấp số liệu và tín hiệu, không thêm thư viện. Ở production (TASK-160, [deployment.md](deployment.md)), Prometheus, Alertmanager (gửi email) và node-exporter chạy cùng Docker Compose (profile `monitoring`). Cấu hình nằm ở `deploy/prometheus/` và `deploy/alertmanager/`; luật cảnh báo đang chạy là `deploy/prometheus/alerts.yml`.

## Nguồn tín hiệu

| Tín hiệu            | Ở đâu                                                          | Dùng để                                                                       |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Health check        | `GET /api/v1/health` (công khai)                               | Kiểm tra từ bên ngoài mỗi phút (uptime check), load balancer bỏ instance hỏng |
| Metrics             | `GET /api/v1/metrics` (cần token)                              | Số request, lỗi, thời gian xử lý, job, database, bộ nhớ của từng instance     |
| Log                 | stdout, JSON, mỗi dòng có `requestId`                          | Điều tra sự cố: tìm theo `requestId`, `tenantId`, `userId` (TASK-034)         |
| Heartbeat sao lưu   | `BACKUP_HEARTBEAT_URL`                                         | Báo khi quá 26 giờ không có lần sao lưu thành công ([backup.md](backup.md))   |
| Máy chủ, PostgreSQL | Nhà cung cấp hạ tầng hoặc `node_exporter`, `postgres_exporter` | CPU, ổ đĩa, kết nối, dung lượng database                                      |

## `GET /api/v1/metrics`

- Tắt mặc định. Đặt `METRICS_TOKEN` (ít nhất 32 ký tự, sinh bằng `openssl rand -hex 32`) để bật, gọi kèm `Authorization: Bearer <METRICS_TOKEN>`. Chưa đặt thì 404, sai token thì 401.
- Định dạng text Prometheus 0.0.4. Không chứa dữ liệu nghiệp vụ hay dữ liệu cá nhân. Nhãn `route` là mẫu route (`/api/v1/properties/:id`), không phải URL thật. Đường dẫn không khớp route nào gộp vào `route="unmatched"`.
- Số liệu nằm trong bộ nhớ từng instance, khởi động lại thì về 0 (counter Prometheus xử lý được). Nhiều instance thì scrape từng instance.

| Metric                                                    | Loại      | Ý nghĩa                                                           |
| --------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `http_requests_total{method,route,status}`                | counter   | Số request đã xử lý                                               |
| `http_request_duration_seconds{method,route}`             | histogram | Thời gian xử lý, mốc 0,05–10 giây                                 |
| `http_requests_in_flight`                                 | gauge     | Request đang xử lý                                                |
| `job_runs_total{job,result}`                              | counter   | Số lần chạy job `appointment-reminder`, `property-verification`   |
| `job_last_success_timestamp_seconds{job}`                 | gauge     | Lần chạy thành công gần nhất (Unix, giây)                         |
| `db_up`                                                   | gauge     | 1 nếu database trả lời `SELECT 1` trong 3 giây                    |
| `db_pool_connections{state}`, `db_pool_waiting_requests`  | gauge     | Kết nối trong pool (`total`, `idle`) và truy vấn đang chờ kết nối |
| `process_resident_memory_bytes`, `nodejs_heap_used_bytes` | gauge     | Bộ nhớ                                                            |
| `nodejs_eventloop_lag_p99_seconds`                        | gauge     | Độ trễ event loop p99 từ lần scrape trước                         |
| `crash_reports_total{platform}`                           | counter   | Số báo cáo lỗi từ web quản trị, app (TASK-159)                    |
| `process_uptime_seconds`                                  | gauge     | Thời gian đã chạy, giảm về 0 là instance vừa khởi động lại        |

Cấu hình Prometheus:

```yaml
scrape_configs:
  - job_name: real-estate-os-backend
    metrics_path: /api/v1/metrics
    scrape_interval: 30s
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/metrics_token
    static_configs:
      - targets: ['backend-1:3000']
```

Không mở `/api/v1/metrics` ra Internet nếu không cần: chặn ở reverse proxy, chỉ cho mạng nội bộ của hệ thống giám sát.

## Cảnh báo đề xuất

Ngưỡng là mặc định Claude chọn, theo mục tiêu p95 < 1 giây ([performance.md](performance.md), [load-testing.md](load-testing.md)) và lịch job hiện có.

| Cảnh báo               | Điều kiện                                                                                  | Mức        |
| ---------------------- | ------------------------------------------------------------------------------------------ | ---------- |
| API không chạy         | Health check từ bên ngoài lỗi 2 lần liên tiếp (2 phút)                                     | Khẩn cấp   |
| Database lỗi           | `db_up == 0` trong 2 phút                                                                  | Khẩn cấp   |
| Lỗi 5xx tăng           | Tỷ lệ 5xx > 1% trong 5 phút (và có ít nhất 1 request/giây)                                 | Cao        |
| API chậm               | p95 toàn bộ > 1 giây trong 10 phút                                                         | Cao        |
| Thiếu kết nối database | `db_pool_waiting_requests > 0` trong 5 phút                                                | Cao        |
| Job ngừng chạy         | Nhắc lịch hẹn quá 15 phút, xác minh BĐS quá 2 giờ không thành công                         | Cao        |
| Sao lưu ngừng          | Heartbeat sao lưu quá 26 giờ không đến                                                     | Cao        |
| Lỗi ứng dụng tăng      | `crash_reports_total` tăng hơn 20 trong 15 phút ([crash-reporting.md](crash-reporting.md)) | Trung bình |
| Event loop nghẽn       | `nodejs_eventloop_lag_p99_seconds > 0.5` trong 5 phút                                      | Trung bình |
| Bộ nhớ cao             | RSS > 80% giới hạn bộ nhớ của container trong 15 phút                                      | Trung bình |
| Ổ đĩa database         | Còn dưới 20% dung lượng                                                                    | Cao        |

Luật Prometheus tương ứng:

```yaml
groups:
  - name: real-estate-os
    rules:
      - alert: DatabaseDown
        expr: db_up == 0
        for: 2m
        labels: { severity: critical }
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01
          and sum(rate(http_requests_total[5m])) > 1
        for: 5m
        labels: { severity: high }
      - alert: SlowRequests
        expr: |
          histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{route!="unmatched"}[5m]))) > 1
        for: 10m
        labels: { severity: high }
      - alert: DatabasePoolExhausted
        expr: max(db_pool_waiting_requests) > 0
        for: 5m
        labels: { severity: high }
      - alert: AppointmentReminderStale
        expr: time() - max(job_last_success_timestamp_seconds{job="appointment-reminder"}) > 900
        for: 5m
        labels: { severity: high }
      - alert: PropertyVerificationStale
        expr: time() - max(job_last_success_timestamp_seconds{job="property-verification"}) > 7200
        for: 10m
        labels: { severity: high }
      - alert: ClientCrashesRising
        expr: sum(increase(crash_reports_total[15m])) > 20
        labels: { severity: medium }
      - alert: EventLoopLag
        expr: nodejs_eventloop_lag_p99_seconds > 0.5
        for: 5m
        labels: { severity: medium }
```

- Job chạy trên mọi instance (job ghi dữ liệu an toàn khi chạy song song), nên luật job dùng `max` theo mọi instance.
- `job_last_success_timestamp_seconds` chỉ có sau lần chạy đầu tiên kể từ khi khởi động. Luật job cũng nên báo khi metric vắng mặt quá lâu (`absent(...)`).
- Sao lưu chạy bằng cron ngoài backend nên không có trong `/metrics`. Đặt `BACKUP_HEARTBEAT_URL` là URL "ping" của dịch vụ kiểu dead man's switch (Healthchecks.io, Uptime Kuma push monitor, Better Stack heartbeat…) với chu kỳ 24 giờ, thời gian ân hạn 2 giờ. Lệnh `backup create` chỉ gọi URL này khi sao lưu thành công.

## Khi có cảnh báo

1. Mở log theo khoảng thời gian cảnh báo, lọc `"level":"error"`. Một request lỗi có `requestId` trong response lỗi và trong log.
2. `GET /api/v1/health` từng instance: 503 là database không trả lời.
3. Chậm: xem `http_request_duration_seconds` theo `route` để biết route nào chậm, đối chiếu [performance.md](performance.md).
4. Job ngừng: tìm log `Job nhắc lịch hẹn lỗi` hoặc `Job xác minh BĐS lỗi`.
5. Sao lưu ngừng: xem log cron của `backup create` (mỗi bước một dòng JSON, lỗi có dòng `Sao lưu lỗi`).

## Code và test

- `backend/src/monitoring/`: `MetricsService` (số liệu, xuất text), `MetricsMiddleware` (đếm request), `MetricsController` (`GET /metrics`, kiểm token bằng so sánh thời gian cố định).
- Job `appointment-reminder`, `property-verification` ghi kết quả từng lần chạy.
- `backend/src/backup/backup.cli.ts`: gọi `BACKUP_HEARTBEAT_URL` sau khi sao lưu thành công.
- Test:
  - `test/monitoring.spec.ts`:
    - Định dạng và histogram.
    - Endpoint cần đúng token, chưa đặt token thì 404.
    - Nhãn là mẫu route, không chứa id thật; 404 gộp vào `unmatched`.
    - Số liệu job và database.
  - `test/backup.spec.ts`: lệnh `create` gọi heartbeat khi thành công, lỗi thì không gọi và exit code 1.
