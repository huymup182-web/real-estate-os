import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';

import '../../support/fake_adapter.dart';

void main() {
  late FakeAdapter adapter;
  late ApiClient client;
  late MemoryTokenStorage tokens;

  setUp(() {
    tokens = MemoryTokenStorage(
      const AuthTokens(accessToken: 'access-1', refreshToken: 'refresh-1'),
    );
    adapter = FakeAdapter((options) {
      switch ((options.method, options.path)) {
        case ('GET', '/properties'):
          return (
            200,
            {
              'success': true,
              'data': [
                {'id': 'p1'},
              ],
              'message': null,
              'meta': {'page': 2, 'pageSize': 1, 'total': 3, 'totalPages': 3},
            },
          );
        case ('POST', '/customers'):
          return (
            400,
            {
              'success': false,
              'data': null,
              'message': 'Dữ liệu không hợp lệ',
              'error': {
                'code': 'VALIDATION_ERROR',
                'details': [
                  {'field': 'phone', 'message': 'phone sai định dạng'},
                  {'field': 'phone', 'message': 'lỗi thứ hai'},
                  {'message': 'lỗi chung'},
                ],
                'requestId': 'req-1',
              },
            },
          );
        case ('DELETE', '/customers/c1'):
          return (204, null);
        case ('GET', '/broken'):
          return (502, '<html>Bad gateway</html>');
        default:
          return (
            200,
            {
              'success': true,
              'data': {'ok': true},
              'message': null,
            },
          );
      }
    });
    client = ApiClient(
      baseUrl: 'https://api.example.vn/api/v1',
      tokens: tokens,
      dio: Dio()..httpClientAdapter = adapter,
    );
  });

  test('gắn Bearer token, bỏ query null, bóc data và meta', () async {
    final response = await client.get(
      '/properties',
      query: {'page': 2, 'q': null},
    );
    final request = adapter.requests.single.options;
    expect(
      request.uri.toString(),
      'https://api.example.vn/api/v1/properties?page=2',
    );
    expect(request.headers['authorization'], 'Bearer access-1');
    expect(response.list, [
      {'id': 'p1'},
    ]);
    expect(response.meta?.total, 3);
    expect(response.meta?.hasNext, isTrue);
  });

  test(
    'auth: false và khi chưa có token thì không gửi authorization',
    () async {
      await client.post('/auth/login', body: {'identifier': 'a'}, auth: false);
      expect(adapter.requests.last.options.headers['authorization'], isNull);
      expect(adapter.requests.last.body, {'identifier': 'a'});

      await tokens.clear();
      await client.get('/auth/me');
      expect(adapter.requests.last.options.headers['authorization'], isNull);
    },
  );

  test('204 trả data null', () async {
    final response = await client.delete('/customers/c1');
    expect(response.data, isNull);
    expect(response.meta, isNull);
  });

  test(
    'lỗi chuẩn của backend thành ApiException có mã, câu và lỗi theo trường',
    () async {
      final error = await _catch(
        () => client.post('/customers', body: {'fullName': 'A'}),
      );
      expect(error.code, ErrorCodes.validationError);
      expect(error.message, 'Dữ liệu không hợp lệ');
      expect(error.statusCode, 400);
      expect(error.requestId, 'req-1');
      expect(error.details, hasLength(3));
      expect(error.fieldErrors, {'phone': 'phone sai định dạng'});
      expect(error.isUnauthenticated, isFalse);
    },
  );

  test('body lỗi không đúng dạng và mất mạng', () async {
    final gateway = await _catch(() => client.get('/broken'));
    expect(gateway.code, ErrorCodes.internalError);
    expect(gateway.statusCode, 502);

    adapter.offline = true;
    final offline = await _catch(() => client.get('/properties'));
    expect(offline.code, ErrorCodes.networkError);
    expect(offline.statusCode, isNull);
  });
}

Future<ApiException> _catch(Future<Object?> Function() call) async {
  try {
    await call();
  } on ApiException catch (error) {
    return error;
  }
  fail('Không ném ApiException');
}
