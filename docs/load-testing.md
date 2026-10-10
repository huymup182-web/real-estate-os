# Kiểm thử tải (TASK-156)

TASK-154 đo từng truy vấn khi chỉ có một người gọi ([performance.md](performance.md)). TASK-156 đo khi nhiều người dùng thao tác cùng lúc, tìm điểm nghẽn và sức chịu của một backend.

## Cách chạy

```bash
cd backend
npm run perf:load   # database riêng <db>_backend_load, xoá và tạo lại mỗi lần chạy
```

- Dữ liệu như `perf:crm`: công ty A có 100.000 BĐS, 50.000 khách, khoảng 272.000 hoạt động, 20.000 lịch hẹn, 10.000 giao dịch. Công ty B có 20% số đó.
- Sau khi sinh dữ liệu chạy `VACUUM ANALYZE`, như database đang chạy thật đã được autovacuum dọn.
- 50 người dùng ảo đăng nhập trước: 20 môi giới (mỗi người vài phiên) và quản trị. Mỗi người lặp lại trong 60 giây: chọn ngẫu nhiên một thao tác theo tỷ lệ dưới đây, gọi API qua HTTP, nghỉ ngẫu nhiên 0–2 giây rồi làm tiếp.
- Đạt khi p95 của từng thao tác < 1000 ms (như TASK-076) và tỷ lệ lỗi (HTTP khác 2xx) < 1%. Không đạt thì exit code 1.
- Biến môi trường: `LOAD_USERS` (50), `LOAD_SECONDS` (60), `LOAD_THINK_MS` (2000), `LOAD_ROWS` (100.000), `LOAD_CUSTOMERS` (50.000), `PERF_P95_MS` (1000).

| Thao tác                                        | Tỷ lệ | Ai gọi    |
| ----------------------------------------------- | ----: | --------- |
| Danh sách BĐS (mới nhất trước)                  |   20% | mọi người |
| Tìm BĐS theo từ khoá ("nha pho", "hem xe h"…)   |   15% | mọi người |
| Lọc BĐS (tỉnh, giá tối đa, số phòng ngủ, giá ↑) |   10% | mọi người |
| Chi tiết BĐS (ghi cả lượt xem)                  |   15% | mọi người |
| Danh sách khách                                 |   10% | mọi người |
| Hoạt động của khách                             |    8% | môi giới  |
| Ghi chăm sóc khách (cuộc gọi)                   |    5% | môi giới  |
| Lịch hẹn 7 ngày                                 |    5% | mọi người |
| Số thông báo chưa đọc                           |    7% | mọi người |
| Dashboard 30 ngày                               |    3% | mọi người |
| Xếp hạng môi giới 30 ngày                       |    2% | mọi người |

Môi trường đo: container cloud 4 vCPU, 16 GB RAM. PostgreSQL 16, backend và chính script tạo tải chạy chung máy, nên tranh CPU với nhau. Kết quả trên server riêng cho database sẽ tốt hơn.

## Điểm nghẽn tìm được và đã sửa

Lần chạy đầu (50 người dùng, nghỉ 0–200 ms) chỉ được 29 request/giây, p95 chung 2,7 giây. CPU của máy dùng hết, phần lớn do PostgreSQL. Ghi log mọi câu SQL trong lúc chạy tải rồi cộng thời gian theo từng câu:

| Điểm nghẽn                                                                                                                                                                                                       | Cách sửa                                                                                           | Kết quả                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Danh sách BĐS mặc định đọc và sắp xếp mọi BĐS của công ty để lấy 20 dòng mới nhất: 0,23 giây mỗi lần. Index `(tenant_id, status, created_at)` có sẵn không dùng được vì danh sách không lọc theo một trạng thái. | Index `properties (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`.                 | Trang đầu còn 0,2 ms.                     |
| Đếm tổng số BĐS xem được (hiện ở danh sách) đọc cả bảng: 60% thời gian CPU của database sau khi sửa lỗi trên.                                                                                                    | Index trên kèm `INCLUDE (status, agent_id, created_by)`: đếm bằng index-only scan, không đọc bảng. | Đếm 100.000 BĐS từ ~80 ms còn ~25 ms CPU. |

Migration: `database/migrations/1791133000000-add-properties-newest-index.ts`. Test `database/test/indexes.test.ts` kiểm danh sách không còn bước sắp xếp và đếm dùng index-only scan.

Không đổi code backend. Pool kết nối database (10, mặc định của `pg`) không phải điểm nghẽn: CPU hết trước.

## Kết quả (2026-10-10)

Cùng kịch bản 50 người dùng, nghỉ 0–200 ms (gần như liên tục), qua từng bước sửa:

| Lần đo                        | Request/giây | p50 chung (ms) | p95 chung (ms) | Lỗi |
| ----------------------------- | -----------: | -------------: | -------------: | --: |
| Trước khi sửa                 |         29,2 |          1.479 |          2.728 |   0 |
| Thêm index danh sách mới nhất |         40,1 |          1.048 |          1.987 |   0 |
| Thêm cột INCLUDE để đếm tổng  |         53,8 |            763 |          1.469 |   0 |

Sức chịu sau khi sửa, nghỉ 0–2 giây (mặc định của `perf:load`):

| Người dùng ảo | Request/giây | p50 chung (ms) | p95 chung (ms) | p95 chậm nhất (ms)  | Kết luận  |
| ------------: | -----------: | -------------: | -------------: | ------------------- | --------- |
|            50 |         42,1 |             79 |            576 | 847 (tìm từ khoá)   | **Đạt**   |
|            75 |         49,7 |            342 |          1.203 | 1.618 (tìm từ khoá) | Không đạt |
|           100 |         51,7 |            799 |          1.719 | 2.057 (tìm từ khoá) | Không đạt |

Chi tiết lần 50 người dùng:

| Thao tác              | Số request | Lỗi | p50 (ms) | p95 (ms) | p99 (ms) |
| --------------------- | ---------: | --: | -------: | -------: | -------: |
| Danh sách BĐS         |        527 |   0 |       80 |      345 |      992 |
| Tìm BĐS theo từ khoá  |        407 |   0 |      391 |      847 |    1.198 |
| Lọc BĐS               |        272 |   0 |      111 |      447 |    1.391 |
| Chi tiết BĐS          |        411 |   0 |       36 |      263 |      801 |
| Danh sách khách       |        218 |   0 |       85 |      227 |      885 |
| Hoạt động của khách   |        182 |   0 |       22 |      237 |    1.204 |
| Ghi chăm sóc khách    |        120 |   0 |       40 |      189 |    1.513 |
| Lịch hẹn 7 ngày       |        127 |   0 |       53 |      223 |    1.080 |
| Số thông báo chưa đọc |        190 |   0 |       14 |      163 |      621 |
| Dashboard 30 ngày     |         86 |   0 |       73 |      194 |      325 |
| Xếp hạng 30 ngày      |         56 |   0 |       92 |      301 |    1.235 |

**Kết luận:** một máy 4 vCPU (backend + database chung) chịu được khoảng 42 request/giây với p95 < 1 giây, không lỗi. Mỗi người dùng ảo thao tác trung bình mỗi 1,2 giây. Người thật thường mở một màn hình mỗi 5–10 giây, nên mức này tương đương khoảng 200–400 người dùng thật cùng lúc. Quá khoảng 50 request/giây thì CPU database hết, thời gian chờ tăng đều ở mọi thao tác (chưa có lỗi).

## Còn lại

- **Tìm theo từ khoá** là phần tốn CPU nhất (khoảng 60% thời gian database khi chạy tải). Từ khoá phổ biến khớp 10.000–37.000 BĐS trong dữ liệu sinh (tiêu đề theo mẫu nên khớp nhiều hơn thực tế). Mỗi lần tìm phải chấm điểm liên quan và đếm hết các BĐS khớp: 0,1–0,3 giây CPU. Hướng tiếp nếu cần:
  - Giới hạn số đếm, ví dụ hiện "hơn 1.000 kết quả". Đổi hiển thị nên cần quyết định riêng.
  - Tách database ra máy riêng hoặc thêm CPU (TASK-160).
- Chạy nhiều instance backend thì giới hạn số lần gọi đăng nhập đếm riêng từng instance ([security-audit.md](security-audit.md)).
- Chưa đo upload ảnh, AI và push: phụ thuộc dịch vụ ngoài (object storage, nhà cung cấp AI, FCM), đo khi có môi trường production.
