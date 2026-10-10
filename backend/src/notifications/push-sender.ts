import { Injectable, Logger } from '@nestjs/common';

/** Một thông báo đẩy tới thiết bị của người nhận. */
export interface PushMessage {
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * Kênh đẩy thông báo (TASK-092). `send` trả true khi đã đẩy được ít nhất tới một thiết bị; lỗi thì ném ra,
 * `NotificationsService` ghi log và bỏ qua. Bản FCM: `FcmPushSender` (TASK-093).
 */
export abstract class PushSender {
  abstract send(message: PushMessage): Promise<boolean>;
}

/** Mặc định khi chưa có kênh đẩy: không gửi gì, thông báo chỉ nằm trong hộp thư. */
@Injectable()
export class NoopPushSender extends PushSender {
  private readonly logger = new Logger(NoopPushSender.name);

  send(message: PushMessage): Promise<boolean> {
    this.logger.debug('Chưa cấu hình kênh đẩy, thông báo chỉ lưu hộp thư', {
      notificationId: message.notificationId,
    });
    return Promise.resolve(false);
  }
}
