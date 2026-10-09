/** Ngày giờ hiện trên trang lịch hẹn, theo giờ Việt Nam. */
export const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});
