import { hash, type Options, parseOptions, verify } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Argon2id (algorithm = 2; enum const của thư viện không import được khi bật verbatimModuleSyntax). */
const ARGON2ID = 2;

/**
 * Tham số băm ghi rõ trong code (mức tối thiểu OWASP cho Argon2id: 19 MiB, 2 vòng, 1 luồng)
 * để nâng cấp thư viện không âm thầm đổi tham số. Muốn tăng độ mạnh: sửa ở đây, mật khẩu cũ
 * tự được băm lại khi user đăng nhập thành công (`needsRehash`).
 */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

/**
 * Chuẩn hoá Unicode (NFKC) trước khi băm/so: cùng một mật khẩu tiếng Việt có dấu gõ từ các bộ gõ
 * khác nhau (dựng sẵn hay tổ hợp) cho ra cùng một chuỗi.
 */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/** Băm mật khẩu bằng Argon2id (phase0/02-ARCHITECTURE.md). Không bao giờ lưu hay log mật khẩu gốc. */
export async function hashPassword(password: string): Promise<string> {
  return hash(normalize(password), ARGON2_OPTIONS);
}

/** So mật khẩu với chuỗi đã băm. Chuỗi băm hỏng thì coi như sai mật khẩu. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, normalize(password));
  } catch {
    return false;
  }
}

/** `true` khi chuỗi băm không dùng đúng thuật toán/tham số hiện tại (cần băm lại). */
export function needsRehash(passwordHash: string): boolean {
  try {
    const current = parseOptions(passwordHash);
    return (
      (current.algorithm as number) !== ARGON2_OPTIONS.algorithm ||
      current.memoryCost !== ARGON2_OPTIONS.memoryCost ||
      current.timeCost !== ARGON2_OPTIONS.timeCost ||
      current.parallelism !== ARGON2_OPTIONS.parallelism ||
      current.outputLen !== ARGON2_OPTIONS.outputLen
    );
  } catch {
    return true;
  }
}
