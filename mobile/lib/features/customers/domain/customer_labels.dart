/// Nhãn tiếng Việt cho giá trị khách hàng (khớp backend `src/customers/customer-values.ts`, web admin
/// `lib/customers.ts`). Giá trị lạ thì hiện nguyên mã (`labelOf`).
const customerStatusLabels = {
  'NEW': 'Mới',
  'CONTACTED': 'Đã liên hệ',
  'QUALIFIED': 'Có nhu cầu thật',
  'VIEWING': 'Đi xem nhà',
  'NEGOTIATING': 'Thương lượng',
  'DEPOSIT': 'Đặt cọc',
  'WON': 'Chốt thành công',
  'LOST': 'Mất khách',
};

const customerPurposeLabels = {
  'LIVING': 'Để ở',
  'INVESTMENT': 'Đầu tư',
  'RENT': 'Cho thuê',
  'OTHER': 'Khác',
};

const purchaseTimelineLabels = {
  'IMMEDIATE': 'Mua ngay',
  'WITHIN_3_MONTHS': 'Trong 3 tháng',
  'WITHIN_6_MONTHS': 'Trong 6 tháng',
  'OVER_6_MONTHS': 'Trên 6 tháng',
  'UNKNOWN': 'Chưa rõ',
};

const customerSourceLabels = {
  'REFERRAL': 'Giới thiệu',
  'WALK_IN': 'Khách tự đến',
  'FACEBOOK': 'Facebook',
  'ZALO': 'Zalo',
  'TIKTOK': 'TikTok',
  'WEBSITE': 'Website',
  'BROKER_PARTNER': 'Đối tác môi giới',
  'OLD_CUSTOMER': 'Khách cũ',
  'OTHER': 'Khác',
};

const transactionTypeLabels = {'SALE': 'Mua', 'RENT': 'Thuê'};

const activityTypeLabels = {
  'CALL': 'Gọi điện',
  'MESSAGE': 'Nhắn tin',
  'PROPERTY_SENT': 'Gửi BĐS',
  'VIEWING': 'Đi xem',
  'NEGOTIATION': 'Thương lượng',
  'DEPOSIT': 'Đặt cọc',
  'NOTE': 'Ghi chú',
  'STATUS_CHANGE': 'Đổi bước',
  'ASSIGNMENT': 'Giao khách',
};
