import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { MailService } from '../mail/mail.service.js';
import { hashPassword } from './password.js';

/** Mã OTP đặt lại mật khẩu sống 15 phút (quyết định TASK-042). */
export const RESET_CODE_TTL_SECONDS = 15 * 60;

const RESET_CODE_LENGTH = 6;

/** Nhập sai mã quá số lần này thì mã bị huỷ, phải xin mã mới (quyết định TASK-042). */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/** Một câu cho mọi trường hợp mã sai/hết hạn/không có, để không lộ email nào có tài khoản. */
export const INVALID_RESET_CODE_MESSAGE = 'Mã đặt lại mật khẩu không đúng hoặc đã hết hạn';

interface ResetCodeRow {
  id: string;
  code_hash: string;
  attempts: number;
}

type ResetOutcome = 'reset' | 'invalid';

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
   * Mã mới làm các mã cũ chưa dùng của user hết hiệu lực. Đặt mật khẩu mới bằng mã: `resetPassword`.
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

  /**
   * Đặt mật khẩu mới bằng mã OTP mới nhất còn hiệu lực của user (TASK-043).
   * Sai mã → tăng attempts; sai đủ RESET_CODE_MAX_ATTEMPTS lần thì huỷ mã.
   * Đúng mã → đổi mật khẩu, đánh dấu mã đã dùng và thu hồi mọi phiên đăng nhập của user.
   * Mọi trường hợp thất bại (không có tài khoản, không có mã, mã sai/hết hạn/đã huỷ) trả cùng một lỗi 400.
   */
  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const user = await this.findActiveUser(email);
    if (!user) {
      throw invalidResetCode();
    }
    // Tăng attempts phải được commit kể cả khi trả lỗi, nên transaction trả kết quả thay vì throw.
    const outcome = await this.dataSource.transaction(async (manager): Promise<ResetOutcome> => {
      const rows: ResetCodeRow[] = await manager.query(
        `SELECT id, code_hash, attempts
           FROM password_reset_tokens
          WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC
          LIMIT 1
            FOR UPDATE`,
        [user.id],
      );
      const stored = rows[0];
      if (!stored) {
        return 'invalid';
      }
      if (!sameHash(stored.code_hash, hashResetCode(user.id, code))) {
        await manager.query(
          `UPDATE password_reset_tokens
              SET attempts = attempts + 1,
                  used_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE used_at END
            WHERE id = $1`,
          [stored.id, RESET_CODE_MAX_ATTEMPTS],
        );
        return 'invalid';
      }
      await manager.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [
        stored.id,
      ]);
      // Chỉ băm khi mã đúng: request mã sai không tốn CPU băm mật khẩu.
      const passwordHash = await hashPassword(newPassword);
      await manager.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
        user.id,
        passwordHash,
      ]);
      await manager.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [user.id],
      );
      return 'reset';
    });
    if (outcome === 'invalid') {
      throw invalidResetCode();
    }
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

function invalidResetCode(): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, INVALID_RESET_CODE_MESSAGE, [
    { field: 'code', message: INVALID_RESET_CODE_MESSAGE },
  ]);
}

/** So hai hash hex cùng độ dài theo thời gian không đổi. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
