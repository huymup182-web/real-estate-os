/// Mã lỗi backend (`backend/src/common/errors/error-code.ts`) cộng hai mã phía app: [networkError] khi không
/// gọi được backend, [unknown] khi body lỗi không đúng định dạng. App xử lý theo mã, không theo câu chữ.
abstract final class ErrorCodes {
  static const validationError = 'VALIDATION_ERROR';
  static const unauthenticated = 'UNAUTHENTICATED';
  static const tokenExpired = 'TOKEN_EXPIRED';
  static const forbidden = 'FORBIDDEN';
  static const notFound = 'NOT_FOUND';
  static const conflict = 'CONFLICT';
  static const duplicateSuspected = 'DUPLICATE_SUSPECTED';
  static const businessRuleViolation = 'BUSINESS_RULE_VIOLATION';
  static const rateLimited = 'RATE_LIMITED';
  static const serviceUnavailable = 'SERVICE_UNAVAILABLE';
  static const internalError = 'INTERNAL_ERROR';
  static const networkError = 'NETWORK_ERROR';
  static const unknown = 'UNKNOWN';
}

/// Lỗi của một trường trong `error.details`.
class FieldError {
  const FieldError({this.field, required this.message});

  final String? field;
  final String message;
}

/// Lỗi khi gọi Backend API, đọc từ body `{success: false, message, error: {code, details, requestId}}`.
class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.message,
    this.statusCode,
    this.details = const [],
    this.requestId,
  });

  final String code;
  final String message;

  /// null khi không có response (mất mạng, hết thời gian chờ).
  final int? statusCode;
  final List<FieldError> details;
  final String? requestId;

  bool get isUnauthenticated =>
      code == ErrorCodes.unauthenticated || code == ErrorCodes.tokenExpired;

  /// Lỗi đầu tiên của từng trường, để hiện ngay dưới ô nhập.
  Map<String, String> get fieldErrors => {
    for (final detail in details.reversed)
      if (detail.field != null) detail.field!: detail.message,
  };

  @override
  String toString() => 'ApiException($code, $statusCode): $message';
}
