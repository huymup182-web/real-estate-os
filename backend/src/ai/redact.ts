/**
 * Số điện thoại Việt Nam (0xxx hoặc +84xxx, có thể cách bởi khoảng trắng, chấm, gạch; không tính số nằm trong
 * số lớn hơn như 5.000.000.000). Ẩn khỏi mô tả BĐS gửi LLM và khỏi tin AI viết, vì tin để đăng công khai
 * (TASK-136); ẩn khỏi ghi chú khách gửi LLM (TASK-140).
 */
const PHONE = /(?<![\d.,])(?:\+84|0)(?:[\s.-]?\d){8,10}(?!\d)/g;
const HIDDEN_PHONE = '[đã ẩn số điện thoại]';

export function hidePhones(text: string): string {
  return text.replace(PHONE, HIDDEN_PHONE);
}
