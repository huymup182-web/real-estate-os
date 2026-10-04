import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';

import { requestPath } from '../logging/request-logger.middleware.js';
import {
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestWithId,
} from '../request-id/request-id.middleware.js';
import { AppException, type ErrorDetail } from './app.exception.js';
import { ERROR_DEFAULTS, ErrorCode } from './error-code.js';

/** Body lỗi chuẩn (phase0/05-API-CONVENTIONS.md, định dạng gộp đã chốt). */
export interface ErrorResponseBody {
  success: false;
  data: null;
  message: string;
  error: { code: ErrorCode; details?: ErrorDetail[]; requestId: string };
}

interface ResolvedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

/** Mã lỗi theo HTTP status cho các HttpException có sẵn của NestJS (NotFoundException…). */
const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  422: ErrorCode.BUSINESS_RULE_VIOLATION,
  429: ErrorCode.RATE_LIMITED,
};

/**
 * Mã lỗi PostgreSQL → mã lỗi API. Không trả tên constraint hay câu lỗi của database cho client.
 * 23505 unique, 23503 khoá ngoại, 23001 restrict, 23514 check, 22P02 sai kiểu (vd uuid sai).
 */
const CODE_BY_PG_ERROR: Readonly<Record<string, ErrorCode>> = {
  '23505': ErrorCode.CONFLICT,
  '23503': ErrorCode.CONFLICT,
  '23001': ErrorCode.CONFLICT,
  '23514': ErrorCode.VALIDATION_ERROR,
  '22P02': ErrorCode.VALIDATION_ERROR,
};

function fromCode(code: ErrorCode, details?: ErrorDetail[]): ResolvedError {
  const { status, message } = ERROR_DEFAULTS[code];
  return { status, code, message, details };
}

function fromStatus(status: number): ResolvedError {
  if (status >= 500) {
    return fromCode(ErrorCode.INTERNAL_ERROR);
  }
  const code = CODE_BY_STATUS[status] ?? ErrorCode.VALIDATION_ERROR;
  return { ...fromCode(code), status };
}

/** Lỗi 4xx của body parser (JSON sai cú pháp, body quá lớn) mang sẵn `status` và `expose`. */
function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const { status, expose } = exception as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true
    ? status
    : undefined;
}

function resolve(exception: unknown): ResolvedError {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }
  if (exception instanceof HttpException) {
    return fromStatus(exception.getStatus());
  }
  if (exception instanceof QueryFailedError) {
    const pgCode = (exception.driverError as { code?: unknown } | undefined)?.code;
    const code = typeof pgCode === 'string' ? CODE_BY_PG_ERROR[pgCode] : undefined;
    if (code) {
      return fromCode(code);
    }
  }
  const status = clientErrorStatus(exception);
  if (status !== undefined) {
    return fromStatus(status);
  }
  return fromCode(ErrorCode.INTERNAL_ERROR);
}

/**
 * Bộ lọc lỗi chung: mọi lỗi đều trả về cùng một định dạng, kèm request id.
 * Lỗi 500 được ghi log đầy đủ ở server; client chỉ nhận câu thông báo chung, không có stack.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const requestId = getRequestId(req);
    const { status, code, message, details } = resolve(exception);

    if (status >= 500) {
      // Lỗi trước middleware (vd body parser) chưa có request context nên ghi kèm requestId ở đây.
      this.logger.error(exception instanceof Error ? exception : String(exception), {
        requestId,
        method: req.method,
        path: requestPath(req),
      });
    }

    const body: ErrorResponseBody = {
      success: false,
      data: null,
      message,
      error: { code, ...(details?.length ? { details } : {}), requestId },
    };
    const res: unknown = http.getResponse();
    const { httpAdapter } = this.adapterHost;
    // Lỗi xảy ra trước middleware (vd JSON sai cú pháp ở body parser) thì header chưa được gắn.
    httpAdapter.setHeader(res, REQUEST_ID_HEADER, requestId);
    httpAdapter.reply(res, body, status);
  }
}
