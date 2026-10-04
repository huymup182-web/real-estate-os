import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenService } from './access-token.service.js';
import type { ClientInfo } from './client-info.js';

/** Refresh token sống 30 ngày, xoay vòng mỗi lần dùng (phase0/02-ARCHITECTURE.md). */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const INVALID_REFRESH_TOKEN_MESSAGE = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Số giây access token còn hiệu lực. */
  expiresIn: number;
}

export interface SessionUser {
  userId: string;
  tenantId: string | null;
}

interface IssuedRefreshToken {
  id: string;
  token: string;
}

interface StoredTokenRow {
  id: string;
  user_id: string;
  tenant_id: string | null;
  family_id: string;
  expired: boolean;
  revoked_at: Date | null;
  replaced_by: string | null;
  user_status: string | null;
  company_status: string | null;
}

type RotateOutcome =
  | { kind: 'rotated'; user: SessionUser; familyId: string; refreshToken: string }
  | { kind: 'invalid' }
  | { kind: 'reused'; familyId: string; userId: string }
  | { kind: 'forbidden'; message: string };

/** Chỉ lưu SHA-256 của token: token là chuỗi ngẫu nhiên 256 bit nên không cần băm chậm như mật khẩu. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /** Mở phiên mới khi đăng nhập: một family mới, trả cặp token. */
  async startSession(user: SessionUser, client: ClientInfo): Promise<TokenPair> {
    const familyId = randomUUID();
    const issued = await this.insertToken(this.dataSource.manager, user, familyId, client);
    return this.tokenPair(user, familyId, issued.token);
  }

  /**
   * Đổi refresh token lấy cặp token mới; token cũ bị thu hồi và trỏ `replaced_by` tới token mới.
   * Token không tồn tại / hết hạn / đã thu hồi → 401. Token đã bị thay thế mà còn được dùng lại
   * (có thể bị đánh cắp) → thu hồi cả family rồi 401. User hoặc công ty không còn hoạt động → 403.
   */
  async rotate(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(refreshToken);
    // Thu hồi cả family phải được commit trước khi trả lỗi, nên transaction trả kết quả thay vì throw.
    const outcome = await this.dataSource.transaction(async (manager): Promise<RotateOutcome> => {
      const rows: StoredTokenRow[] = await manager.query(
        `SELECT t.id, t.user_id, t.tenant_id, t.family_id, t.expires_at <= now() AS expired,
                  t.revoked_at, t.replaced_by,
                  u.status AS user_status, c.status AS company_status
             FROM refresh_tokens t
             LEFT JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
             LEFT JOIN companies c ON c.id = t.tenant_id AND c.deleted_at IS NULL
            WHERE t.token_hash = $1
              FOR UPDATE OF t`,
        [tokenHash],
      );
      const stored = rows[0];
      if (!stored) {
        return { kind: 'invalid' };
      }
      if (stored.revoked_at !== null) {
        if (stored.replaced_by === null) {
          return { kind: 'invalid' };
        }
        await manager.query(
          `UPDATE refresh_tokens SET revoked_at = now()
              WHERE family_id = $1 AND revoked_at IS NULL`,
          [stored.family_id],
        );
        return { kind: 'reused', familyId: stored.family_id, userId: stored.user_id };
      }
      if (stored.expired || stored.user_status === null) {
        return { kind: 'invalid' };
      }
      if (stored.user_status !== 'ACTIVE') {
        return { kind: 'forbidden', message: 'Tài khoản đã bị khoá hoặc ngừng hoạt động' };
      }
      if (stored.tenant_id !== null && stored.company_status !== 'ACTIVE') {
        return { kind: 'forbidden', message: 'Công ty đang bị tạm ngưng' };
      }

      const user: SessionUser = { userId: stored.user_id, tenantId: stored.tenant_id };
      const issued = await this.insertToken(manager, user, stored.family_id, client);
      await manager.query(
        `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`,
        [stored.id, issued.id],
      );
      return { kind: 'rotated', user, familyId: stored.family_id, refreshToken: issued.token };
    });

    switch (outcome.kind) {
      case 'rotated':
        return this.tokenPair(outcome.user, outcome.familyId, outcome.refreshToken);
      case 'reused':
        this.logger.warn('Refresh token đã thay thế bị dùng lại, thu hồi cả phiên', {
          userId: outcome.userId,
          familyId: outcome.familyId,
        });
        throw new AppException(ErrorCode.UNAUTHENTICATED, INVALID_REFRESH_TOKEN_MESSAGE);
      case 'forbidden':
        throw new AppException(ErrorCode.FORBIDDEN, outcome.message);
      case 'invalid':
        throw new AppException(ErrorCode.UNAUTHENTICATED, INVALID_REFRESH_TOKEN_MESSAGE);
    }
  }

  private async insertToken(
    manager: EntityManager,
    user: SessionUser,
    familyId: string,
    client: ClientInfo,
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const rows: { id: string }[] = await manager.query(
      `INSERT INTO refresh_tokens
         (user_id, tenant_id, token_hash, family_id, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
       RETURNING id`,
      [
        user.userId,
        user.tenantId,
        hashRefreshToken(token),
        familyId,
        client.deviceInfo,
        client.ipAddress,
        REFRESH_TOKEN_TTL_SECONDS,
      ],
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('Không tạo được refresh token');
    }
    return { id, token };
  }

  private async tokenPair(
    user: SessionUser,
    familyId: string,
    refreshToken: string,
  ): Promise<TokenPair> {
    const accessToken = await this.accessTokens.sign({ ...user, sessionId: familyId });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }
}
