import { Logger } from '@nestjs/common';

import type { AppConfig } from '../config/app-config.js';
import type { DeviceTokenStore } from './device-token-store.js';
import { FcmClient, type FcmSendResult, toFcmData } from './fcm.client.js';
import { NoopPushSender, PushSender, type PushMessage } from './push-sender.js';

/** Có FCM_CONFIG thì đẩy qua FCM, không thì chỉ lưu hộp thư. */
export function pushSenderFor(config: AppConfig, deviceTokens: DeviceTokenStore): PushSender {
  return config.fcm
    ? new FcmPushSender(new FcmClient(config.fcm), deviceTokens)
    : new NoopPushSender();
}

/**
 * Đẩy thông báo qua FCM tới mọi thiết bị của người nhận (TASK-093). Token hỏng bị xoá; trả true khi gửi
 * được ít nhất một thiết bị, false khi người nhận chưa có thiết bị nào, ném lỗi khi mọi lần gửi đều lỗi.
 */
export class FcmPushSender extends PushSender {
  private readonly logger = new Logger(FcmPushSender.name);

  constructor(
    private readonly client: FcmClient,
    private readonly deviceTokens: DeviceTokenStore,
  ) {
    super();
  }

  async send(message: PushMessage): Promise<boolean> {
    const tokens = await this.deviceTokens.tokensOf(message.userId);
    if (tokens.length === 0) {
      return false;
    }

    const payload = {
      title: message.title,
      body: message.body,
      data: {
        ...toFcmData(message.data),
        type: message.type,
        notificationId: message.notificationId,
      },
    };
    const results = await Promise.allSettled(
      tokens.map((token) => this.client.send(token, payload)),
    );

    const invalid = tokens.filter((_, i) => isResult(results[i], 'invalid-token'));
    if (invalid.length > 0) {
      await this.deviceTokens.remove(invalid);
      this.logger.debug('Đã xoá token FCM không còn hợp lệ', {
        userId: message.userId,
        count: invalid.length,
      });
    }

    const sent = results.some((result) => isResult(result, 'sent'));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
      if (!sent) {
        throw failure.reason;
      }
      this.logger.warn('Một số thiết bị không nhận được tin đẩy FCM', {
        notificationId: message.notificationId,
        error: String(failure.reason),
      });
    }
    return sent;
  }
}

function isResult(
  result: PromiseSettledResult<FcmSendResult> | undefined,
  value: FcmSendResult,
): boolean {
  return result?.status === 'fulfilled' && result.value === value;
}
