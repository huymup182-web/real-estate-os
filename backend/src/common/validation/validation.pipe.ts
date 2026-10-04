import { ValidationPipe, type ValidationError } from '@nestjs/common';

import { AppException, type ErrorDetail } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.js';

/** Đổi cây lỗi của class-validator thành danh sách phẳng; trường lồng nhau ghi dạng `address.street`, `items.0.name`. */
export function toErrorDetails(errors: ValidationError[], parentPath = ''): ErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...toErrorDetails(error.children ?? [], field)];
  });
}

/**
 * ValidationPipe toàn cục (phase0/05-API-CONVENTIONS.md mục 6):
 * - whitelist + forbidNonWhitelisted: trường không khai báo trong DTO (kể cả tenantId) bị từ chối;
 * - transform: body/query/param được đổi sang instance của DTO (vd query `?page=2` → số khi DTO dùng `@Type(() => Number)`);
 * - lỗi trả 400 VALIDATION_ERROR kèm `details` theo từng trường.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Không gửi lại giá trị client đã nhập hay tên class DTO trong lỗi.
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new AppException(ErrorCode.VALIDATION_ERROR, undefined, toErrorDetails(errors)),
  });
}
