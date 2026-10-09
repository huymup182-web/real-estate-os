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
  late FakeAdapter adapter;
  late AuthRepository repository;

  setUp(() {
    tokens = MemoryTokenStorage(
      const AuthTokens(accessToken: 'a', refreshToken: 'r'),
    );
    me = () => (200, meResponse);
    adapter = FakeAdapter((options) => me());
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
}
