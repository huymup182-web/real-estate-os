/**
 * Nơi lấy token FCM của thiết bị người dùng cho `FcmPushSender` (TASK-093). Bản lưu bảng `device_tokens`
 * là `DeviceTokensService` (TASK-094).
 */
export abstract class DeviceTokenStore {
  abstract tokensOf(userId: string): Promise<string[]>;
  /** Xoá token FCM báo không còn hợp lệ (gỡ app, đăng xuất). */
  abstract remove(tokens: string[]): Promise<void>;
}
