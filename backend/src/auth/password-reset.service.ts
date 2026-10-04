import { createHash, randomInt } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { MailService } from '../mail/mail.service.js';

/** Mã OTP đặt lại mật khẩu sống 15 phút (quyết định TASK-042). */
export const RESET_CODE_TTL_SECONDS = 15 * 60;

const RESET_CODE_LENGTH = 6;

export interface ForgotPasswordResult {
  /** Số giây mã còn hiệu lực, để app hiện đếm ngược. Trả giống nhau dù email có tồn tại hay không. */
  expiresIn: number;
}

interface ResetUserRow {
  id: string;
  email: string;
}

/** Hash mã kèm user id: mã 6 số có thể trùng giữa các user nên không băm riêng mã. */
export function hashResetCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

export function generateResetCode(): string {
  return String(randomInt(0, 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, '0');
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
  ) {}

  /**
   * Gửi mã OTP 6 số tới email nếu email thuộc một tài khoản đang hoạt động (công ty cũng đang hoạt động).
   * Luôn trả cùng một kết quả để không lộ email nào có tài khoản.
   * Mã mới làm các mã cũ chưa dùng của user hết hiệu lực. Đặt mật khẩu mới bằng mã ở TASK-043.
   */
  async requestReset(email: string): Promise<ForgotPasswordResult> {
    const user = await this.findActiveUser(email);
    if (user) {
      const code = generateResetCode();
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE password_reset_tokens SET used_at = now()
            WHERE user_id = $1 AND used_at IS NULL`,
          [user.id],
        );
        await manager.query(
          `INSERT INTO password_reset_tokens (user_id, code_hash, expires_at)
           VALUES ($1, $2, now() + make_interval(secs => $3))`,
          [user.id, hashResetCode(user.id, code), RESET_CODE_TTL_SECONDS],
        );
      });
      // Không chờ SMTP: thời gian phản hồi không phụ thuộc việc có gửi email hay không.
      this.mail
        .send({
          to: user.email,
          subject: 'Mã đặt lại mật khẩu',
          text: [
            `Mã đặt lại mật khẩu của bạn là: ${code}`,
            '',
            `Mã có hiệu lực trong ${RESET_CODE_TTL_SECONDS / 60} phút và chỉ dùng được một lần.`,
            'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
          ].join('\n'),
        })
        .catch((error: unknown) => {
          this.logger.error('Gửi email mã đặt lại mật khẩu thất bại', {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    return { expiresIn: RESET_CODE_TTL_SECONDS };
  }

  private async findActiveUser(email: string): Promise<ResetUserRow | undefined> {
    const rows: ResetUserRow[] = await this.dataSource.query(
      `SELECT u.id, u.email
         FROM users u
         LEFT JOIN companies c ON c.id = u.tenant_id AND c.deleted_at IS NULL
        WHERE u.email = $1 AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
          AND (u.tenant_id IS NULL OR c.status = 'ACTIVE')`,
      [email],
    );
    return rows[0];
  }
}
