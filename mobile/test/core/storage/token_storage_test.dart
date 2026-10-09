import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('SecureTokenStorage lưu, đọc, xoá cặp token', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final storage = SecureTokenStorage();
    expect(await storage.read(), isNull);

    await storage.save(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
    final saved = await storage.read();
    expect(saved?.accessToken, 'a');
    expect(saved?.refreshToken, 'r');

    await storage.clear();
    expect(await storage.read(), isNull);
  });

  test('thiếu một trong hai token thì coi như chưa đăng nhập', () async {
    FlutterSecureStorage.setMockInitialValues({'auth.access_token': 'a'});
    expect(await SecureTokenStorage().read(), isNull);
  });
}
