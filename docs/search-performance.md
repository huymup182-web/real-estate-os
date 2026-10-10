# Hiệu năng tìm kiếm BĐS (TASK-076)

Mục tiêu (phase0/01-PRD.md, yêu cầu phi chức năng): **tìm kiếm < 1 giây với ~100.000 BĐS mỗi công ty**.

## Cách đo

```bash
docker compose up -d --wait postgres
cd backend && npm run perf:search
```

Script `backend/test/perf/search.perf.ts`:

- Dùng database riêng `<tên db>_backend_perf` (xoá và tạo lại mỗi lần chạy, chạy đủ migration).
- Sinh dữ liệu bằng `generate_series`:
  - Công ty A có 100.000 BĐS, công ty B có 20.000 BĐS (để kiểm việc tách công ty không làm chậm).
  - Có 20 môi giới, 5 tỉnh × 20 phường.
  - Tiêu đề, mô tả, địa chỉ ghép từ từ vựng BĐS thường gặp.
  - Giá, diện tích, số phòng, pháp lý, hướng, độ rộng đường rải đều, có giá trị trống.
  - Khoảng 5% BĐS đã bán, 3% đang ẩn.
- Gọi qua HTTP như client thật: xác thực, kiểm quyền, đếm tổng, phân trang 20 dòng.
- Mỗi truy vấn chạy 20 lần sau 2 lần khởi động, báo p50/p95/max.
- Truy vấn nào p95 ≥ 1000 ms thì exit code 1.
- Tuỳ chỉnh bằng biến môi trường: `PERF_ROWS` (số BĐS công ty A), `PERF_RUNS`, `PERF_P95_MS`.

Không nằm trong `npm test`, vì seed và đo mất khoảng 1 phút.

## Kết quả (2026-10-09)

Môi trường: container cloud 4 vCPU, 15 GB RAM, PostgreSQL 16.4 (PostGIS) trong Docker, backend và database cùng máy, một người gọi tuần tự.

`agent` là môi giới: được xem mọi BĐS của công ty nhưng không được xem liên hệ chủ nhà. `admin` được xem tất cả.

| Truy vấn                             | Người gọi | Kết quả | p50 (ms) | p95 (ms) | max (ms) |
| ------------------------------------ | --------- | ------: | -------: | -------: | -------: |
| Danh sách mặc định (mới nhất)        | agent     |  97.121 |      178 |      223 |      227 |
| Trang sâu (page=2000)                | agent     |  97.121 |      159 |      181 |      189 |
| Từ khoá phổ biến "nha pho"           | agent     |  19.545 |      349 |      420 |      421 |
| Từ khoá phổ biến (admin)             | admin     |  20.000 |      184 |      217 |      217 |
| Từ khoá nhiều từ "biet thu ho boi"   | agent     |  10.597 |      542 |      658 |      694 |
| Từ khoá gõ dở "hem xe h"             | agent     |  35.881 |      594 |      651 |      704 |
| Đúng mã BĐS                          | agent     |       1 |        8 |       10 |       13 |
| Giá + loại + phòng ngủ, xếp giá tăng | agent     |   3.444 |       32 |       41 |       41 |
| Tỉnh + phường, xếp giá giảm          | agent     |   1.003 |       15 |       17 |       19 |
| Diện tích, xếp diện tích tăng        | agent     |   8.350 |       24 |       26 |       30 |
| Pháp lý + hướng + đường ≥ 6m         | agent     |   3.094 |       73 |       85 |       85 |
| Từ khoá + mọi bộ lọc, theo độ khớp   | agent     |     315 |       91 |      103 |      113 |
| Chạy lại tìm kiếm đã lưu (TASK-075)  | agent     |   1.556 |      104 |      120 |      128 |

**Đạt:** mọi truy vấn p95 < 1000 ms. Kết quả chênh vài chục ms giữa các lần chạy.

## Nhận xét

- **Bộ lọc thường** (giá, diện tích, khu vực, loại, phòng, pháp lý, hướng, đường) chạy dưới 120 ms nhờ các index `(tenant_id, …)` của TASK-026.
- **Danh sách không lọc** khoảng 200 ms. Phần lớn thời gian là đếm tổng (`meta.total`) trên gần 100.000 dòng. Trang sâu không chậm hơn trang đầu.
- **Từ khoá với môi giới chậm nhất**, p95 khoảng 650 ms, tức 2/3 ngân sách.
  - Người không được xem liên hệ chủ nhà không được tìm theo địa chỉ (TASK-064), nên mỗi dòng khớp `search_vector` phải tính thêm tsvector của tiêu đề + mô tả. Phần này không có index.
  - Cùng truy vấn với admin chỉ khoảng 200 ms.
  - Khi nhiều người tìm cùng lúc, đây là chỗ dễ vượt 1 giây đầu tiên.
  - Hướng tối ưu (chưa làm, cần migration): thêm cột sinh `search_vector_public` (tiêu đề + mô tả) có index GIN. Môi giới không có quyền liên hệ sẽ dùng cột này thay cho biểu thức tính từng dòng.
- **Xếp theo độ khớp** (TASK-073) chỉ tính `ts_rank` trên các dòng đã lọc. Với 315 dòng thì không đáng kể.
