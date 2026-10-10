import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';

import '../../support/fake_adapter.dart';

const _expired = (
  401,
  {
    'success': false,
    'data': null,
    'message': 'Phiên đăng nhập đã hết hạn',
    'error': {'code': 'TOKEN_EXPIRED', 'requestId': 'r'},
  },
);

void main() {
  late FakeAdapter adapter;
  late MemoryTokenStorage tokens;
  late ApiClient client;
  late (int, Object?) Function() refreshResponse;

  setUp(() {
    tokens = MemoryTokenStorage(
      const AuthTokens(accessToken: 'old', refreshToken: 'refresh-old'),
    );
    refreshResponse = () => (
      200,
      {
        'success': true,
        'data': {
          'accessToken': 'new',
          'refreshToken': 'refresh-new',
          'expiresIn': 900,
        },
        'message': null,
      },
    );
    adapter = FakeAdapter((options) {
      if (options.path == '/auth/refresh') {
        return refreshResponse();
      }
      if (options.headers['authorization'] == 'Bearer old') {
        return _expired;
      }
      return (
        200,
        {
          'success': true,
          'data': {'path': options.path},
          'message': null,
        },
      );
    });
    client = ApiClient(
      baseUrl: 'https://api.example.vn/api/v1',
      tokens: tokens,
      dio: Dio()..httpClientAdapter = adapter,
    );
  });

  List<String> paths() => [for (final r in adapter.requests) r.options.path];

  test('token hết hạn: làm mới, lưu cặp mới, gọi lại với token mới', () async {
    final response = await client.get('/auth/me');
    expect(response.object, {'path': '/auth/me'});
    expect(paths(), ['/auth/me', '/auth/refresh', '/auth/me']);
    expect(adapter.requests[1].body, {'refreshToken': 'refresh-old'});
    expect(adapter.requests[1].options.headers['authorization'], isNull);
    expect(
      adapter.requests.last.options.headers['authorization'],
      'Bearer new',
    );
    final saved = await tokens.read();
    expect(saved?.accessToken, 'new');
    expect(saved?.refreshToken, 'refresh-new');
  });

  test('nhiều request cùng hết hạn chỉ làm mới một lần', () async {
    await Future.wait([
      client.get('/properties'),
      client.get('/customers'),
      client.get('/notifications'),
    ]);
    expect(paths().where((path) => path == '/auth/refresh'), hasLength(1));
  });

  test('refresh token hết hiệu lực: xoá token, báo chưa đăng nhập, phát sessionExpired', () async {
    var expiredEvents = 0;
    final subscription = client.sessionExpired.listen((_) => expiredEvents++);
    addTearDown(subscription.cancel);
    refreshResponse = () => (
      401,
      {
        'success': false,
        'data': null,
        'message': 'Chưa đăng nhập',
        'error': {'code': 'UNAUTHENTICATED', 'requestId': 'r2'},
      },
    );
    await expectLater(
      client.get('/auth/me'),
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', ErrorCodes.unauthenticated)
            .having((e) => e.isUnauthenticated, 'isUnauthenticated', isTrue),
      ),
    );
    expect(await tokens.read(), isNull);
  });

  test(
    'mất mạng khi làm mới: báo lỗi mạng, giữ token để thử lại sau',
    () async {
      refreshResponse = () => (0, null);
      await expectLater(
        client.get('/auth/me'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            ErrorCodes.networkError,
          ),
        ),
      );
      expect((await tokens.read())?.refreshToken, 'refresh-old');
    },
  );

  test('chỉ làm mới một lần; API công khai không làm mới', () async {
    refreshResponse = () => (
      200,
      {
        'success': true,
        'data': {'accessToken': 'old', 'refreshToken': 'refresh-x'},
        'message': null,
      },
    );
    await expectLater(
      client.get('/auth/me'),
      throwsA(
        isA<ApiException>().having((e) => e.code, 'code', 'TOKEN_EXPIRED'),
      ),
    );
    expect(paths(), ['/auth/me', '/auth/refresh', '/auth/me']);

    adapter.requests.clear();
    await tokens.save(
      const AuthTokens(accessToken: 'old', refreshToken: 'refresh-old'),
    );
    await client.get('/public', auth: false);
    expect(paths(), ['/public']);
  });
}
