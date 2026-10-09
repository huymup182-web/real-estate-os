import { Injectable } from '@nestjs/common';

/**
 * Nơi lấy token FCM của thiết bị người dùng (TASK-093). Bảng `device_tokens` và API đăng ký token làm ở
 * TASK-094; tới lúc đó dùng `EmptyDeviceTokenStore`, nên chưa có thiết bị nào nhận được tin đẩy.
 */
export abstract class DeviceTokenStore {
  abstract tokensOf(userId: string): Promise<string[]>;
  /** Xoá token FCM báo không còn hợp lệ (gỡ app, đăng xuất). */
  abstract remove(tokens: string[]): Promise<void>;
}

@Injectable()
export class EmptyDeviceTokenStore extends DeviceTokenStore {
  tokensOf(): Promise<string[]> {
    return Promise.resolve([]);
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }
}
