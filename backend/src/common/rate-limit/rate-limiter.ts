import { Injectable } from '@nestjs/common';

import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.js';

/** Một luật giới hạn: tối đa `limit` lần trong mỗi cửa sổ `windowSeconds` giây. */
export interface RateLimitRule {
  /** Tiền tố khoá, vd `login:ip`. */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Bị chặn vì quá giới hạn: 429, kèm số giây cần chờ (bộ lọc lỗi chung gắn header `Retry-After`). */
export class RateLimitedException extends AppException {
  constructor(readonly retryAfterSeconds: number) {
    super(ErrorCode.RATE_LIMITED, 'Quá nhiều yêu cầu, vui lòng thử lại sau');
  }
}

interface Window {
  count: number;
  resetAt: number;
}

/** Dọn các cửa sổ đã hết hạn sau mỗi chừng này lần đếm, để bộ nhớ không phình. */
const SWEEP_EVERY = 1000;

/**
 * Bộ đếm giới hạn số lần theo cửa sổ cố định, giữ trong bộ nhớ của tiến trình (TASK-155). Dùng chặn dò mật khẩu,
 * dò mã OTP, gửi email hàng loạt ở các route xác thực. Chạy nhiều instance thì mỗi instance đếm riêng
 * (docs/security-audit.md).
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private operations = 0;

  /** Thời điểm hiện tại (ms); test ghi đè để tua giờ. */
  protected now(): number {
    return Date.now();
  }

  /** Đã tới giới hạn của [key] theo [rule] → ném RateLimitedException; không đếm thêm. */
  check(rule: RateLimitRule, key: string): void {
    const window = this.current(rule, key);
    if (window && window.count >= rule.limit) {
      throw new RateLimitedException(Math.max(1, Math.ceil((window.resetAt - this.now()) / 1000)));
    }
  }

  /** Đếm thêm một lần cho [key] theo [rule]. */
  hit(rule: RateLimitRule, key: string): void {
    this.sweep();
    const id = `${rule.name}:${key}`;
    const window = this.current(rule, key);
    if (window) {
      window.count += 1;
    } else {
      this.windows.set(id, { count: 1, resetAt: this.now() + rule.windowSeconds * 1000 });
    }
  }

  /** check rồi hit: cho các route đếm mọi lần gọi. */
  consume(rule: RateLimitRule, key: string): void {
    this.check(rule, key);
    this.hit(rule, key);
  }

  /** Xoá bộ đếm của [key], vd đăng nhập đúng thì không tính các lần sai trước đó của tài khoản. */
  reset(rule: RateLimitRule, key: string): void {
    this.windows.delete(`${rule.name}:${key}`);
  }

  /** Xoá mọi bộ đếm (test dùng giữa các ca để các ca không ảnh hưởng nhau). */
  clear(): void {
    this.windows.clear();
  }

  private current(rule: RateLimitRule, key: string): Window | undefined {
    const id = `${rule.name}:${key}`;
    const window = this.windows.get(id);
    if (window && window.resetAt <= this.now()) {
      this.windows.delete(id);
      return undefined;
    }
    return window;
  }

  private sweep(): void {
    this.operations += 1;
    if (this.operations % SWEEP_EVERY !== 0) {
      return;
    }
    const now = this.now();
    for (const [id, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(id);
      }
    }
  }
}
