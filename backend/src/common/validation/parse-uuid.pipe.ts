import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.js';

/**
 * Kiểm tra tham số đường dẫn là UUID trước khi chạm database,
 * vd `@Get(':id') findOne(@Param('id', ParseUuidPipe) id: string)`.
 * Sai thì trả 400 VALIDATION_ERROR với `details` chỉ rõ tham số.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, metadata: ArgumentMetadata): string {
    if (typeof value === 'string' && isUUID(value)) {
      return value;
    }
    const field = metadata.data ?? 'id';
    throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, [
      { field, message: `${field} phải là UUID` },
    ]);
  }
}
