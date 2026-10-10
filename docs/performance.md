# Tối ưu hiệu năng (TASK-154)

Mục tiêu giữ như TASK-076 (phase0/01-PRD.md, yêu cầu phi chức năng): mỗi truy vấn p95 < 1 giây với công ty khoảng 100.000 BĐS. TASK-154 đo thêm CRM, báo cáo, thị trường và matching, sửa các chỗ chậm, rồi đo lại cả tìm kiếm.

## Cách đo

```bash
cd backend
npm run perf:crm      # CRM, báo cáo, thị trường, matching (database riêng <db>_backend_perf_crm)
npm run perf:search   # tìm kiếm BĐS (TASK-076, database riêng <db>_backend_perf)
```

- Hai script dùng chung `backend/test/perf/perf-support.ts`. Mỗi lần chạy xoá database riêng, chạy đủ migration rồi sinh dữ liệu bằng `generate_series`.
- Gọi qua HTTP như client thật. Mỗi truy vấn chạy 20 lần sau 2 lần khởi động. Truy vấn nào p95 ≥ 1000 ms thì exit code 1.
- `perf:crm` sinh cho công ty A:
  - 100.000 BĐS, 50.000 khách tạo rải trong 400 ngày (1/25 chưa giao cho ai).
  - Mỗi khách 0–11 hoạt động, khoảng 272.000 hoạt động.
  - 20.000 lịch hẹn, khoảng 10.000 giao dịch, 25.000 nhu cầu.
  - Công ty B có 20% số đó.
- Đo với `admin` (phạm vi cả công ty) và `agent` (môi giới, phạm vi của mình).
- Biến môi trường: `PERF_ROWS`, `PERF_CUSTOMERS`, `PERF_RUNS`, `PERF_P95_MS`.

Môi trường: container cloud 4 vCPU, PostgreSQL 16 cùng máy với backend, một người gọi tuần tự.

## Đã sửa

| Chỗ chậm                                         | Nguyên nhân                                                                                                                                                                               | Cách sửa                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thanh khoản thị trường (TASK-147): hơn 3 phút    | Đếm lượt dẫn khách cho từng BĐS, nhưng `appointments` không có index theo BĐS. 100.000 BĐS × quét cả bảng lịch hẹn.                                                                       | Index `appointments (tenant_id, property_id, scheduled_at)`. Lượt xem, lượt dẫn khách gom theo BĐS một lần rồi nối vào. Tổng chung và từng nhóm tính trong một truy vấn (`GROUPING SETS`). |
| Mọi báo cáo nặng: thêm 1–2,5 giây                | PostgreSQL bật JIT khi chi phí ước tính cao. Chuyển đổi 366 ngày mất 2,45 giây biên dịch JIT cho phần chạy chỉ khoảng 0,3 giây.                                                           | Tắt JIT cho kết nối của backend (`extra.options = '-c jit=off'` trong `src/database/database.module.ts`). Ứng dụng chỉ chạy truy vấn ngắn, JIT không có lợi.                               |
| Bảng xếp hạng (TASK-151) 366 ngày: 1,7 giây      | Với từng môi giới, đếm lại tin đăng, ngày chăm sóc (nối cả bảng khách mỗi lần), dẫn khách, giao dịch.                                                                                     | Mỗi chỉ số gom theo người một lần rồi nối vào. Ngày chăm sóc đếm bằng `DISTINCT` rồi `count` thay cho `count(DISTINCT (…))`.                                                               |
| Chuyển đổi (TASK-153) 366 ngày: 2,7–3,4 giây     | Truy vấn con tìm mốc của khách (liên hệ, chốt…) lặp lại ở nhiều bước phễu. Tổng chung và từng nhóm chạy hai lần.                                                                          | Mỗi khách tính mốc một lần. Hoạt động, lịch hẹn, giao dịch gom theo khách (chỉ khách tạo trong kỳ) rồi nối vào. Tổng chung và nhóm tính trong một truy vấn.                                |
| BĐS phù hợp với khách (TASK-088): 3,3–4,8 giây   | Đọc mọi BĐS đang bán của công ty thành entity đầy đủ (gồm mô tả). Dựng lời giải thích cho mọi BĐS khớp, kể cả những BĐS bị cắt khỏi top.                                                  | Chỉ đọc cột cần cho chấm điểm, dạng thô. Lời giải thích chỉ dựng cho các BĐS được giữ lại.                                                                                                 |
| Tìm từ khoá với môi giới (TASK-064): p95 ~650 ms | Người không được xem địa chỉ chỉ được tìm theo tiêu đề và mô tả. Backend phải tính tsvector này cho từng dòng, không có index (đề xuất ở [search-performance.md](search-performance.md)). | Cột sinh `properties.search_vector_public` (tiêu đề + mô tả) có index GIN. Điều kiện tìm kiếm cho ra cùng kết quả, cả hai nhánh đều dùng index.                                            |

Migration: `database/migrations/1791132000000-add-performance-indexes.ts`. Thiết kế index: [database.md](database.md) mục 6.

## Kết quả `perf:crm` (2026-10-10)

Cột "Trước" là lần đo trước khi sửa: lần chậm hơn trong 2 lần gọi, không phải p95. Thanh khoản bị ngắt sau 180 giây.

| Truy vấn                       | Người gọi | Trước (ms) | p50 (ms) | p95 (ms) |
| ------------------------------ | --------- | ---------: | -------: | -------: |
| Dashboard 30 ngày              | admin     |        102 |       67 |       80 |
| Dashboard 366 ngày             | admin     |         44 |       66 |       79 |
| Doanh số 12 tháng              | admin     |         94 |       40 |       50 |
| Chuyển đổi 90 ngày             | admin     |      2.806 |      233 |      300 |
| Chuyển đổi 366 ngày            | admin     |      3.459 |      492 |      552 |
| Chuyển đổi 366 ngày            | agent     |        358 |      318 |      434 |
| Xếp hạng 30 ngày               | admin     |      1.097 |      116 |      145 |
| Xếp hạng 366 ngày              | admin     |      1.725 |      497 |      576 |
| Giá thị trường 12 tháng        | admin     |        206 |      196 |      244 |
| Giá/m² theo phường 24 tháng    | admin     |         96 |       67 |       82 |
| Thanh khoản theo loại 12 tháng | admin     |  > 180.000 |      352 |      381 |
| Danh sách khách                | admin     |         83 |       49 |       61 |
| Khách theo bước pipeline       | admin     |         33 |       26 |       30 |
| Dashboard khách 30 ngày        | admin     |        455 |      317 |      371 |
| Danh sách giao dịch            | admin     |         74 |       53 |       69 |
| Lịch hẹn một tháng             | admin     |          - |       47 |       55 |
| Khách phù hợp với BĐS          | admin     |        564 |      343 |      456 |
| BĐS phù hợp với khách          | admin     |      4.765 |      834 |      957 |

**Đạt:** mọi truy vấn p95 < 1000 ms.

## Kết quả `perf:search` (2026-10-10)

So với lần đo TASK-076 ([search-performance.md](search-performance.md)):

| Truy vấn                           | Người gọi | p95 TASK-076 (ms) | p95 TASK-154 (ms) |
| ---------------------------------- | --------- | ----------------: | ----------------: |
| Từ khoá phổ biến "nha pho"         | agent     |               420 |           252–304 |
| Từ khoá nhiều từ "biet thu ho boi" | agent     |               658 |           246–260 |
| Từ khoá gõ dở "hem xe h"           | agent     |               651 |           390–436 |
| Danh sách mặc định (mới nhất)      | agent     |               223 |           342–361 |
| Pháp lý + hướng + đường ≥ 6m       | agent     |                85 |           129–143 |

Hai dòng cuối không đổi code nhưng cũng chậm hơn khoảng 1,5 lần so với lần đo trước. Máy đo lần này chậm hơn (đang chạy thêm database perf CRM và server demo). Ước theo tỷ lệ đó, tìm từ khoá với môi giới nhanh hơn khoảng 2–3 lần.

## Còn lại

- **BĐS phù hợp với khách** gần ngưỡng nhất (p95 ~0,96 s khi công ty có 92.000 BĐS đang bán).
  - Phần lớn thời gian là đọc 92.000 dòng từ PostgreSQL vào Node: riêng việc đọc mất khoảng 0,7 s, chấm điểm chỉ khoảng 0,1 s.
  - Hướng tiếp (chưa làm): chấm điểm bằng SQL rồi chỉ trả top N. Cách này phải giữ luật chấm điểm ở hai nơi (TypeScript và SQL), nên để khi cần.
- **Tìm khách theo tên** dùng `ILIKE` nên phân biệt dấu ("nguyen" không ra "Nguyễn"), như thiết kế TASK-108. Nếu cần tìm không dấu thì làm thành task riêng.
- PgBouncer mặc định từ chối tham số khởi động `options`. Nếu production đi qua PgBouncer, thêm `options` vào `ignore_startup_parameters` và tắt JIT bằng `ALTER ROLE <user> SET jit = off`.
