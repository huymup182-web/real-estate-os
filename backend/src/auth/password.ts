import { hash } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Băm mật khẩu bằng Argon2id (phase0/02-ARCHITECTURE.md). Không bao giờ lưu hay log mật khẩu gốc. */
export async function hashPassword(password: string): Promise<string> {
  // algorithm 2 = Argon2id (enum const của thư viện không import được khi bật verbatimModuleSyntax).
  return hash(password, { algorithm: 2 });
}
