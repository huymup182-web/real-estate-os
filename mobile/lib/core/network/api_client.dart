import 'package:dio/dio.dart';

import '../error/api_exception.dart';
import '../storage/token_storage.dart';
import 'api_response.dart';

/// Gọi Backend API (`<API_BASE_URL>/api/v1`): gắn access token, bóc body `{success, data, meta}`, đổi mọi lỗi
/// thành [ApiException]. Feature chỉ gọi qua lớp này, không dùng Dio trực tiếp.
class ApiClient {
  ApiClient({required String baseUrl, required TokenStorage tokens, Dio? dio})
    : _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = baseUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30)
      ..responseType = ResponseType.json
      ..headers['accept'] = 'application/json';
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['auth'] != false) {
            final saved = await tokens.read();
            if (saved != null) {
              options.headers['authorization'] = 'Bearer ${saved.accessToken}';
            }
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;

  /// `auth: false` cho API không cần đăng nhập (đăng nhập, quên mật khẩu).
  Future<ApiResponse> get(
    String path, {
    Map<String, Object?>? query,
    bool auth = true,
  }) => _send('GET', path, query: query, auth: auth);

  Future<ApiResponse> post(String path, {Object? body, bool auth = true}) =>
      _send('POST', path, body: body, auth: auth);

  Future<ApiResponse> patch(String path, {Object? body}) =>
      _send('PATCH', path, body: body);

  Future<ApiResponse> delete(String path) => _send('DELETE', path);

  Future<ApiResponse> _send(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? body,
    bool auth = true,
  }) async {
    try {
      final response = await _dio.request<Object?>(
        path,
        data: body,
        queryParameters: query == null ? null : _withoutNulls(query),
        options: Options(method: method, extra: {'auth': auth}),
      );
      return _parseSuccess(response);
    } on DioException catch (error) {
      throw _toApiException(error);
    }
  }
}

Map<String, Object> _withoutNulls(Map<String, Object?> query) => {
  for (final entry in query.entries)
    if (entry.value != null) entry.key: entry.value!,
};

ApiResponse _parseSuccess(Response<Object?> response) {
  final body = response.data;
  // 204 không có body.
  if (body == null || body == '') {
    return const ApiResponse(data: null);
  }
  if (body is! Map<String, dynamic>) {
    throw ApiException(
      code: ErrorCodes.unknown,
      message: 'Phản hồi từ máy chủ không đúng định dạng',
      statusCode: response.statusCode,
    );
  }
  final meta = body['meta'];
  return ApiResponse(
    data: body['data'],
    meta: meta is Map<String, dynamic> ? PageMeta.fromJson(meta) : null,
  );
}

/// Đổi lỗi Dio thành [ApiException]: có body lỗi chuẩn thì lấy mã, câu, chi tiết từ backend; mất mạng hoặc
/// hết thời gian chờ thành [ErrorCodes.networkError].
ApiException _toApiException(DioException error) {
  if (error.error is ApiException) {
    return error.error! as ApiException;
  }
  final response = error.response;
  if (response == null) {
    return const ApiException(
      code: ErrorCodes.networkError,
      message: 'Không kết nối được máy chủ, vui lòng kiểm tra mạng',
    );
  }
  final body = response.data;
  final payload = body is Map<String, dynamic> ? body['error'] : null;
  if (payload is! Map<String, dynamic> || payload['code'] is! String) {
    return ApiException(
      code: response.statusCode != null && response.statusCode! >= 500
          ? ErrorCodes.internalError
          : ErrorCodes.unknown,
      message: 'Có lỗi khi gọi máy chủ (HTTP ${response.statusCode})',
      statusCode: response.statusCode,
    );
  }
  final message = (body as Map<String, dynamic>)['message'];
  final details = payload['details'];
  return ApiException(
    code: payload['code'] as String,
    message: message is String && message.isNotEmpty
        ? message
        : 'Có lỗi khi gọi máy chủ',
    statusCode: response.statusCode,
    requestId: payload['requestId'] is String
        ? payload['requestId'] as String
        : null,
    details: details is List<dynamic>
        ? [
            for (final item in details.whereType<Map<String, dynamic>>())
              FieldError(
                field: item['field'] is String ? item['field'] as String : null,
                message: item['message'] is String
                    ? item['message'] as String
                    : '',
              ),
          ]
        : const [],
  );
}
