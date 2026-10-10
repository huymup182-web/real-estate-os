# Sao lưu và khôi phục (TASK-157)

## Cần sao lưu gì

| Dữ liệu                                  | Nằm ở                        | Cách sao lưu                                                                          |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| Toàn bộ dữ liệu nghiệp vụ, audit log     | PostgreSQL                   | Lệnh `backup create` dưới đây: bản chụp hằng ngày, gửi ra kho lưu trữ khác            |
| Ảnh, giấy tờ BĐS                         | Object storage (`STORAGE_*`) | Bật versioning của bucket; nếu nhà cung cấp hỗ trợ thì sao chép sang bucket/vùng khác |
| Secret (`JWT_SECRET`, khoá storage, AI…) | Hệ thống triển khai          | Lưu trong trình quản lý secret của hạ tầng (TASK-160), không nằm trong bản sao lưu    |

Bản sao lưu database chỉ có tên file (`storage_key`) của ảnh, không có ảnh. Khôi phục database về một ngày thì ảnh của ngày đó phải còn trên bucket, nên bucket ảnh không được xoá object cũ sớm hơn thời gian giữ bản sao lưu.

## Lịch và thời gian giữ (Huy Lê chọn ngày 2026-10-10)

- Sao lưu **hằng ngày lúc 02:00** giờ Việt Nam. Nếu sự cố xảy ra, mất tối đa 1 ngày dữ liệu.
- Trên máy chạy lệnh: giữ **7 ngày** (`BACKUP_KEEP_DAYS`). Luôn giữ bản mới nhất, kể cả khi đã quá hạn.
- Trên kho lưu trữ: giữ **30 ngày**, đặt bằng lifecycle rule của bucket (xem dưới).
- Diễn tập khôi phục **mỗi tuần** (`backup check`), để chắc bản sao lưu dùng được.

Đổi lịch hoặc số ngày giữ không cần sửa code: đổi lịch chạy và biến môi trường.

## Lệnh

Chạy trong `backend/` sau `npm run build`. Máy chạy lệnh cần `pg_dump`/`pg_restore` cùng bản chính với máy chủ PostgreSQL (16), ví dụ gói `postgresql-client-16`.

```bash
npm run backup -- create                    # sao lưu, gửi lên kho, xoá bản cũ trên máy
npm run backup -- list                      # bản sao lưu trên máy và trên kho
npm run backup -- check                     # diễn tập khôi phục bản mới nhất trên máy
npm run backup -- check <tên>               # diễn tập một bản cụ thể (tải từ kho nếu máy không có)
npm run backup -- restore <tên> <database>  # khôi phục vào database MỚI
```

Ở production gọi thẳng `node dist/backup/backup.cli.js <lệnh>` với biến môi trường của hệ thống triển khai. Mỗi bước in một dòng JSON. Lỗi thì exit code 1, để cron hoặc hệ thống giám sát báo (TASK-158).

- **create**:
  - `pg_dump --format=custom` (nén, khôi phục được từng bảng), ghi ra file tạm.
  - `pg_restore --list` đọc lại được thì mới đổi thành `<database>-<YYYYMMDDTHHmmssZ>.dump`, nên file `.dump` trong thư mục luôn là bản hoàn chỉnh.
  - Gửi lên `BACKUP_BUCKET` kèm SHA-256 trong metadata, rồi xoá bản trên máy cũ hơn `BACKUP_KEEP_DAYS`.
  - Mật khẩu database truyền qua biến môi trường `PGPASSWORD`, không nằm trong tham số dòng lệnh.
- **check**: khôi phục vào database tạm `<database>_restore_check`, đếm số bảng, số dòng từng bảng và migration cuối, rồi xoá database tạm. Không đụng tới database đang chạy.
- **restore**: tạo database mới rồi khôi phục vào đó. Không bao giờ ghi đè: database đích đã có (kể cả database đang chạy) thì dừng. Khôi phục lỗi giữa chừng thì xoá database vừa tạo. Bản tải từ kho được kiểm SHA-256 trước khi dùng.

Lập lịch (ví dụ crontab trên máy chạy backend, cấu hình chính thức ở TASK-160):

```cron
CRON_TZ=Asia/Ho_Chi_Minh
0 2 * * *  cd /app/backend && node dist/backup/backup.cli.js create >> /var/log/backup.log 2>&1
30 3 * * 0 cd /app/backend && node dist/backup/backup.cli.js check  >> /var/log/backup.log 2>&1
```

## Kho lưu trữ

- Dùng bucket riêng, khác bucket ảnh, tốt nhất ở tài khoản hoặc nhà cung cấp khác. Như vậy mất máy chủ hoặc lộ khoá của API cũng không mất bản sao lưu.
- Khoá `BACKUP_ACCESS_KEY_ID` chỉ cần quyền `PutObject`, thêm `GetObject` và `ListBucket` khi khôi phục. Không cần quyền xoá: kẻ chiếm được máy chủ không xoá được bản sao lưu cũ.
- Thời gian giữ đặt bằng lifecycle rule. Ví dụ S3 (R2 có mục tương tự trong Object lifecycle rules):

```json
{
  "Rules": [
    {
      "ID": "xoa-ban-sao-luu-cu",
      "Filter": { "Prefix": "database/" },
      "Status": "Enabled",
      "Expiration": { "Days": 30 }
    }
  ]
}
```

- Một lần PUT tối đa 5 GB với S3. Database dự kiến (100.000 BĐS mỗi công ty) cho file vài trăm MB. Khi gần ngưỡng thì chuyển sang upload nhiều phần.

## Khôi phục khi có sự cố

1. Dừng ghi vào database hỏng (tắt backend hoặc bật chế độ bảo trì).
2. Chọn bản sao lưu: `npm run backup -- list`.
3. Khôi phục vào database mới, ví dụ `npm run backup -- restore real_estate_os-20261010T190000Z.dump real_estate_os_20261010`.
4. Kiểm tra dữ liệu: đăng nhập thử, xem số liệu chính. Cần thì so sánh bằng `backup check`.
5. Đổi `DATABASE_URL` của backend sang database mới rồi khởi động lại. Database cũ giữ lại để điều tra, chỉ xoá khi chắc chắn không cần.

Dữ liệu ghi sau bản sao lưu đã chọn (tối đa 1 ngày) bị mất. Nếu cần mất ít hơn, dùng PostgreSQL có point-in-time recovery (WAL archiving) của nhà cung cấp database quản lý; bản sao lưu hằng ngày vẫn giữ làm lớp dự phòng.

## Code và test

- `backend/src/backup/backup-config.ts`: đọc và kiểm biến `BACKUP_*` (docs/environment.md).
- `backend/src/backup/backup.ts`: sao lưu, gửi/tải, xoá bản cũ, khôi phục, diễn tập.
- `backend/src/backup/backup.cli.ts`: lệnh `create | list | check | restore`.
- `backend/test/backup.spec.ts`:
  - Kiểm cấu hình.
  - Kiểm tên file và luật xoá bản cũ.
  - Sao lưu database test, khôi phục vào database mới rồi so số dòng từng bảng với bản gốc.
  - Không ghi đè database đã có, kể cả database đang chạy.
  - File hỏng thì không tạo database.
  - Diễn tập tự xoá database tạm.
  - Gửi và tải qua một S3 giả: kiểm SHA-256, và báo lỗi khi file tải về bị hỏng.
