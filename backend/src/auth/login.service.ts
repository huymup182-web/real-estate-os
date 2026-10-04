import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenService } from './access-token.service.js';
import type { LoginDto } from './dto/login.dto.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';

export interface LoginUser {
  id: string;
  tenantId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export interface LoginResult {
  accessToken: string;
  /** Số giây access token còn hiệu lực. */
  expiresIn: number;
  user: LoginUser;
}

interface UserRow {
  id: string;
  tenant_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  status: string;
  company_status: string | null;
}

/** Một câu cho mọi trường hợp sai email/SĐT/mật khẩu, để không lộ tài khoản nào tồn tại. */
export const INVALID_CREDENTIALS_MESSAGE = 'Email/số điện thoại hoặc mật khẩu không đúng';

@Injectable()
export class LoginService {
  /** Băm giả dùng khi không tìm thấy user, để thời gian phản hồi giống khi sai mật khẩu. */
  private readonly dummyHash: Promise<string> = hashPassword('khong-co-tai-khoan-nay');

  constructor(
    private readonly dataSource: DataSource,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /**
   * Kiểm tra thông tin đăng nhập. Sai email/SĐT hoặc mật khẩu → 401 cùng một câu thông báo.
   * Đúng mật khẩu nhưng tài khoản hoặc công ty không hoạt động → 403.
   * Thành công → access token (TASK-039); refresh token thêm ở TASK-040.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.findUser(dto.identifier);
    const passwordOk = await verifyPassword(
      user?.password_hash ?? (await this.dummyHash),
      dto.password,
    );
    if (!user || !passwordOk) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, INVALID_CREDENTIALS_MESSAGE);
    }
    if (user.status !== 'ACTIVE') {
      throw new AppException(ErrorCode.FORBIDDEN, 'Tài khoản đã bị khoá hoặc ngừng hoạt động');
    }
    if (user.tenant_id !== null && user.company_status !== 'ACTIVE') {
      throw new AppException(ErrorCode.FORBIDDEN, 'Công ty đang bị tạm ngưng');
    }

    // Tham số băm đã đổi từ lần băm trước → băm lại bằng tham số hiện tại (lúc này mới có mật khẩu gốc).
    const newHash = needsRehash(user.password_hash) ? await hashPassword(dto.password) : null;
    await this.dataSource.query(
      `UPDATE users SET last_login_at = now(), password_hash = COALESCE($2, password_hash) WHERE id = $1`,
      [user.id, newHash],
    );
    const accessToken = await this.accessTokens.sign({ userId: user.id, tenantId: user.tenant_id });
    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
      },
    };
  }

  /** Có `@` → tìm theo email (không phân biệt hoa thường, cột citext); còn lại tìm theo SĐT. */
  private async findUser(identifier: string): Promise<UserRow | undefined> {
    const column = identifier.includes('@') ? 'email' : 'phone';
    const rows: UserRow[] = await this.dataSource.query(
      `SELECT u.id, u.tenant_id, u.full_name, u.email, u.phone, u.password_hash, u.status,
              c.status AS company_status
         FROM users u
         LEFT JOIN companies c ON c.id = u.tenant_id AND c.deleted_at IS NULL
        WHERE u.${column} = $1 AND u.deleted_at IS NULL`,
      [identifier],
    );
    return rows[0];
  }
}
