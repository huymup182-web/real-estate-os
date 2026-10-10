/** Mã lỗi trả cho client (phase0/05-API-CONVENTIONS.md mục 4). Client xử lý theo mã, không theo câu chữ. */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  DUPLICATE_SUSPECTED = 'DUPLICATE_SUSPECTED',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** HTTP status mặc định và câu thông báo mặc định của từng mã lỗi. */
export const ERROR_DEFAULTS: Readonly<Record<ErrorCode, { status: number; message: string }>> = {
  [ErrorCode.VALIDATION_ERROR]: { status: 400, message: 'Dữ liệu không hợp lệ' },
  [ErrorCode.UNAUTHENTICATED]: { status: 401, message: 'Chưa đăng nhập' },
  [ErrorCode.TOKEN_EXPIRED]: { status: 401, message: 'Phiên đăng nhập đã hết hạn' },
  [ErrorCode.FORBIDDEN]: { status: 403, message: 'Không có quyền thực hiện thao tác này' },
  [ErrorCode.NOT_FOUND]: { status: 404, message: 'Không tìm thấy dữ liệu' },
  [ErrorCode.CONFLICT]: { status: 409, message: 'Dữ liệu bị trùng hoặc đang được sử dụng' },
  [ErrorCode.DUPLICATE_SUSPECTED]: { status: 409, message: 'Nghi trùng với dữ liệu đã có' },
  [ErrorCode.BUSINESS_RULE_VIOLATION]: {
    status: 422,
    message: 'Thao tác vi phạm quy tắc nghiệp vụ',
  },
  [ErrorCode.RATE_LIMITED]: { status: 429, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau' },
  [ErrorCode.SERVICE_UNAVAILABLE]: {
    status: 503,
    message: 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau',
  },
  [ErrorCode.INTERNAL_ERROR]: { status: 500, message: 'Có lỗi hệ thống, vui lòng thử lại sau' },
};
