import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';

import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Gửi email qua SMTP (cấu hình SMTP_* trong docs/environment.md). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: ReturnType<typeof createTransport> | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const mail = config.mail;
    this.transport = mail
      ? createTransport(
          {
            host: mail.host,
            port: mail.port,
            secure: mail.secure,
            ...(mail.user && mail.password
              ? { auth: { user: mail.user, pass: mail.password } }
              : {}),
          },
          { from: mail.from },
        )
      : null;
  }

  /**
   * Gửi một email dạng chữ thuần. Chưa cấu hình SMTP (chỉ ngoài production) thì bỏ qua và ghi cảnh báo.
   * Không ghi nội dung email vào log vì có thể chứa mã bí mật.
   */
  async send(message: MailMessage): Promise<void> {
    if (!this.transport) {
      this.logger.warn('Chưa cấu hình SMTP_HOST, bỏ qua gửi email', { subject: message.subject });
      return;
    }
    await this.transport.sendMail(message);
  }
}
