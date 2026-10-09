/** Trạng thái lịch hẹn, khớp CHECK của `appointments.status`. */
export const APPOINTMENT_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Kết quả buổi xem, khớp CHECK của `appointments.outcome`; chỉ có khi lịch COMPLETED. */
export const APPOINTMENT_OUTCOMES = [
  'INTERESTED',
  'NOT_INTERESTED',
  'NEED_FOLLOW_UP',
  'NEGOTIATING',
] as const;

/** Trạng thái chỉ đặt được khi đã tới giờ hẹn (buổi xem đã diễn ra hoặc khách không đến). */
export const STATUSES_AFTER_START: readonly AppointmentStatus[] = ['COMPLETED', 'NO_SHOW'];

/** Bắt buộc ghi kết quả khi đánh dấu COMPLETED (TASK-084, Huy Lê chọn ngày 2026-10-09): không bắt buộc. */
export const OUTCOME_REQUIRED = false;
