import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/auth/data/auth_repository.dart';

import '../../support/fake_adapter.dart';
import '../../support/fixtures.dart';

void main() {
  late MemoryTokenStorage tokens;
  late (int, Object?) Function() me;
  late (int, Object?) Function() login;
  late (int, Object?) Function() logout;
  late FakeAdapter adapter;
  late AuthRepository repository;

  setUp(() {
    tokens = MemoryTokenStorage(
      const AuthTokens(accessToken: 'a', refreshToken: 'r'),
    );
    me = () => (200, meResponse);
    login = () => (
      200,
      {
        'success': true,
        'data': {
          'accessToken': 'access-new',
          'refreshToken': 'refresh-new',
          'expiresIn': 900,
          'user': {'id': 'u1'},
        },
        'message': null,
      },
    );
    logout = () => (204, null);
    adapter = FakeAdapter(
      (options) => switch (options.path) {
        '/auth/login' => login(),
        '/auth/logout' => logout(),
        '/auth/forgot-password' => (
          200,
          {
            'success': true,
            'data': {'expiresIn': 900},
            'message': null,
          },
        ),
        '/auth/reset-password' => (204, null),
        _ => me(),
      },
    );
    repository = AuthRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: tokens,
        dio: Dio()..httpClientAdapter = adapter,
      ),
      tokens,
    );
  });

  test('chưa có token: chưa đăng nhập, không gọi API', () async {
    await tokens.clear();
    expect(await repository.restore(), isNull);
    expect(adapter.requests, isEmpty);
  });

  test('có token: đọc người dùng từ /auth/me', () async {
    final user = await repository.restore();
    expect(adapter.requests.single.options.path, '/auth/me');
    expect(user?.fullName, 'Nguyễn Văn An');
    expect(user?.companyName, 'Công ty BĐS Demo');
    expect(user?.roles, ['Môi giới']);
    expect(user?.can('property.view'), isTrue);
    expect(user?.can('audit.view'), isFalse);
  });

  for (final (status, code) in [(401, 'UNAUTHENTICATED'), (403, 'FORBIDDEN')]) {
    test('$status $code: xoá token, coi như chưa đăng nhập', () async {
      me = () => (status, errorBody(code));
      expect(await repository.restore(), isNull);
      expect(await tokens.read(), isNull);
    });
  }

  test('mất mạng hoặc lỗi máy chủ: ném lỗi, giữ token', () async {
    me = () => (0, null);
    await expectLater(
      repository.restore(),
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          ErrorCodes.networkError,
        ),
      ),
    );
    me = () => (500, errorBody('INTERNAL_ERROR'));
    await expectLater(repository.restore(), throwsA(isA<ApiException>()));
    expect(await tokens.read(), isNotNull);
  });

  test('đăng nhập: gửi identifier, mật khẩu không kèm token; lưu token rồi đọc /auth/me', () async {
    await tokens.clear();
    final user = await repository.signIn(
      identifier: '+84901234567',
      password: 'mat-khau',
    );
    expect(user.fullName, 'Nguyễn Văn An');
    final loginRequest = adapter.requests.first;
    expect(loginRequest.options.path, '/auth/login');
    expect(loginRequest.body, {
      'identifier': '+84901234567',
      'password': 'mat-khau',
    });
    expect(loginRequest.options.headers['authorization'], isNull);
    expect(
      adapter.requests.last.options.headers['authorization'],
      'Bearer access-new',
    );
    expect((await tokens.read())?.refreshToken, 'refresh-new');
  });

  test('đăng nhập sai: ném lỗi của backend, không lưu token', () async {
    await tokens.clear();
    login = () =>
        (401, errorBody('UNAUTHENTICATED', 'Sai thông tin đăng nhập'));
    await expectLater(
      repository.signIn(identifier: 'a@b.vn', password: 'x'),
      throwsA(
        isA<ApiException>().having(
          (e) => e.message,
          'message',
          'Sai thông tin đăng nhập',
        ),
      ),
    );
    expect(await tokens.read(), isNull);
  });

  test('đăng nhập được nhưng /auth/me lỗi: xoá token vừa lưu', () async {
    me = () => (0, null);
    await expectLater(
      repository.signIn(identifier: 'a@b.vn', password: 'x'),
      throwsA(isA<ApiException>()),
    );
    expect(await tokens.read(), isNull);
  });

  test(
    'đăng xuất: gọi /auth/logout rồi xoá token, kể cả khi mất mạng',
    () async {
      await repository.signOut();
      expect(adapter.requests.single.options.path, '/auth/logout');
      expect(
        adapter.requests.single.options.headers['authorization'],
        'Bearer a',
      );
      expect(await tokens.read(), isNull);

      await tokens.save(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
      logout = () => (0, null);
      await repository.signOut();
      expect(await tokens.read(), isNull);
    },
  );

  test('đổi mật khẩu: gửi mã rồi đặt mật khẩu mới, không kèm token', () async {
    expect(await repository.requestPasswordReset('an@demo.vn'), 900);
    await repository.resetPassword(
      email: 'an@demo.vn',
      code: '123456',
      newPassword: 'MatKhauMoi1',
    );
    expect(adapter.requests.map((r) => r.options.path), [
      '/auth/forgot-password',
      '/auth/reset-password',
    ]);
    expect(adapter.requests.map((r) => r.body), [
      {'email': 'an@demo.vn'},
      {'email': 'an@demo.vn', 'code': '123456', 'newPassword': 'MatKhauMoi1'},
    ]);
    for (final request in adapter.requests) {
      expect(request.options.headers['authorization'], isNull);
    }
  });

  test('me: đọc lại /auth/me', () async {
    final user = await repository.me();
    expect(adapter.requests.single.options.path, '/auth/me');
    expect(user.fullName, 'Nguyễn Văn An');
  });
}
