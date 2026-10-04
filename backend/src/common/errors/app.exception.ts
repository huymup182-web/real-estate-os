import { HttpException } from '@nestjs/common';

import { ERROR_DEFAULTS, ErrorCode } from './error-code.js';

/** Chi tiết lỗi theo từng trường, vd `{ field: 'price', message: 'price phải >= 0' }`. */
export interface ErrorDetail {
  field?: string;
  message: string;
}

/**
 * Lỗi nghiệp vụ có mã lỗi rõ ràng. Service ném lỗi này; bộ lọc lỗi chung đổi thành response chuẩn.
 * vd `throw new AppException(ErrorCode.BUSINESS_RULE_VIOLATION, 'Không chuyển được từ SOLD sang AVAILABLE')`.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string = ERROR_DEFAULTS[code].message,
    readonly details?: ErrorDetail[],
  ) {
    super(message, ERROR_DEFAULTS[code].status);
  }
}
