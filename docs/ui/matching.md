# Đặc tả giao diện matching (TASK-091)

Huy Lê chọn ngày 2026-10-09: viết đặc tả trước, code khi dựng admin web (Next.js, TASK-100) và app Flutter (TASK-113). Màn hình ráp từ design system (`docs/design-system`, PR #16, đang chờ duyệt); tên component dưới đây theo `component-inventory.md` của PR đó.

Nơi code dự kiến:

| Nền tảng | Màn hình                                    | Task                            |
| -------- | ------------------------------------------- | ------------------------------- |
| Admin    | Tab "Khách phù hợp" trong chi tiết BĐS      | TASK-107 (Property management)  |
| Admin    | Tab "BĐS phù hợp" trong chi tiết khách      | TASK-108 (Customer management)  |
| Mobile   | Khối "Khách phù hợp" trong màn chi tiết BĐS | màn chi tiết BĐS của Phase 10   |
| Mobile   | Khối "BĐS phù hợp" trong màn chi tiết khách | màn chi tiết khách của Phase 10 |

## API dùng

| Màn hình      | API (TASK-090)                                  | Quyền route     |
| ------------- | ----------------------------------------------- | --------------- |
| Khách phù hợp | `GET /api/v1/properties/:id/matching-customers` | `property.view` |
| BĐS phù hợp   | `GET /api/v1/customers/:id/matching-properties` | `customer.view` |

Cả hai nhận `minScore` (0..100, mặc định 50) và `limit` (1..100, mặc định 20), trả mảng đã xếp điểm cao trước. Mỗi phần tử có `score`, `criteria [{criterion, weight, ratio}]`, `explanation {summary, matched, partial, unmatched}` và `customer {id, fullName, status, agentId}` hoặc `property {id, code, title, propertyType, transactionType, price, area}`. UI không tự tính điểm, không tự dựng câu giải thích.

## Thành phần mới

### MatchScoreBadge

Điểm dạng `92%` trong badge, luôn có chữ (không chỉ màu):

| Điểm    | Nhãn phụ (tooltip / đọc màn hình)     | Màu badge (dạng nhẹ) |
| ------- | ------------------------------------- | -------------------- |
| ≥ 80    | Rất phù hợp                           | `success`            |
| 65 – 79 | Phù hợp                               | `info`               |
| 50 – 64 | Tạm phù hợp                           | `warning`            |
| < 50    | Ít phù hợp (chỉ hiện khi hạ minScore) | `muted`              |

Mốc 80/65/50 là đề xuất của Claude, chỉnh được khi code.

### MatchCriteriaList

Danh sách tiêu chí từ `criteria`, theo thứ tự API trả (theo trọng số). Mỗi dòng: icon trạng thái + tên tiêu chí (`CRITERION_LABELS` ở backend: ngân sách, khu vực, diện tích, số phòng ngủ, loại BĐS, đường vào, pháp lý) + trọng số mờ (`30 điểm`).

- `ratio = 1`: icon check, `success`, "Đúng".
- `0 < ratio < 1`: icon gần đúng, `warning`, "Gần đúng".
- `ratio = 0`: icon x, `mutedForeground`, "Chưa đúng".

Tiêu chí khách không nêu không có trong `criteria` nên không hiện.

## Khách phù hợp (chi tiết BĐS)

Admin: tab trong trang chi tiết BĐS, bảng `DataTable` (không phân trang, tối đa `limit` dòng):

| Cột        | Nội dung                                                                   |
| ---------- | -------------------------------------------------------------------------- |
| Điểm       | `MatchScoreBadge`                                                          |
| Khách      | `fullName`, link tới chi tiết khách                                        |
| Trạng thái | `StatusBadge` bước pipeline của khách                                      |
| Môi giới   | Tên môi giới phụ trách (`agentId`; cần tra tên khi code, API chưa trả tên) |
| Lý do      | `explanation.summary`, 1 dòng, bấm mở `Sheet` có `MatchCriteriaList`       |

Phía trên bảng: bộ lọc "Điểm tối thiểu" (`Select`: 50 / 65 / 80, gắn `minScore`) và số kết quả. Mobile: danh sách thẻ dọc, mỗi thẻ gồm điểm, tên khách, trạng thái và `summary` 2 dòng; bấm thẻ mở bottom sheet `MatchCriteriaList` với nút "Xem khách".

## BĐS phù hợp (chi tiết khách)

Admin: tab trong trang chi tiết khách, lưới `PropertyListItem`; mobile: danh sách `PropertyCard`. Mỗi mục thêm `MatchScoreBadge` ở góc và `explanation.summary` dưới thông số. Bấm mở chi tiết BĐS; nút phụ "Lý do" mở `MatchCriteriaList`. Cùng bộ lọc "Điểm tối thiểu".

Gợi ý hành động sau khi xem (dùng API đã có, không thêm logic matching): "Ghi đã gửi BĐS" tạo hoạt động `PROPERTY_SENT` (`POST /customers/:id/activities`), "Đặt lịch xem" mở form tạo lịch hẹn (`POST /appointments`).

## Trạng thái màn hình

| Trường hợp                                    | Hiển thị                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Đang tải                                      | `LoadingSkeleton` đúng hình bảng / thẻ                                                     |
| Mảng rỗng, BĐS → khách                        | `EmptyState` "Chưa có khách phù hợp" · "Hạ điểm tối thiểu hoặc thêm nhu cầu cho khách."    |
| Mảng rỗng, khách → BĐS                        | `EmptyState` "Chưa có BĐS phù hợp" · nút "Thêm nhu cầu" nếu khách chưa có nhu cầu đang bật |
| 403 (thiếu `property.view` / `customer.view`) | Ẩn tab; vào thẳng URL thì `ErrorState` 403                                                 |
| 404                                           | `ErrorState` 404 "Không tìm thấy BĐS / khách"                                              |
| Lỗi khác                                      | `ErrorState` + "Thử lại"                                                                   |

Thiếu quyền xem phía còn lại (vd có `property.view` nhưng không có `customer.view`) thì API trả mảng rỗng: ẩn tab "Khách phù hợp" khi user không có `customer.view`, thay vì hiện danh sách rỗng gây hiểu nhầm.

## Định dạng

Giá, diện tích theo bảng định dạng trong `patterns.md` (`3,2 tỷ`, `80 m²`). Điểm là số nguyên kèm `%`.

## Việc cần khi code

- Danh sách BĐS phù hợp muốn dùng `PropertyCard` đầy đủ (ảnh bìa, địa chỉ, phòng ngủ, trạng thái) thì phải mở rộng `property` trong kết quả của `propertiesForCustomer` (hiện chỉ có id, mã, tiêu đề, loại, loại giao dịch, giá, diện tích).
- Cột môi giới cần tên: hoặc API trả thêm `agent {id, fullName}`, hoặc admin tra từ danh sách user.
- Thêm `MatchScoreBadge`, `MatchCriteriaList` vào `component-inventory.md` khi code.
