import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/config/app_config.dart';

void main() {
  group('AppConfig.parse', () {
    test('bỏ / cuối và ghép /api/v1', () {
      final config = AppConfig.parse(
        apiBaseUrl: ' https://api.example.vn/ ',
        env: 'production',
      );
      expect(config.apiBaseUrl, 'https://api.example.vn');
      expect(config.apiUrl, 'https://api.example.vn/api/v1');
      expect(config.isProduction, isTrue);
    });

    test('local cho phép http', () {
      final config = AppConfig.parse(
        apiBaseUrl: 'http://10.0.2.2:3000',
        env: 'local',
      );
      expect(config.env, AppEnv.local);
      expect(config.apiUrl, 'http://10.0.2.2:3000/api/v1');
    });

    test(
      'mặc định khi không truyền --dart-define là local trỏ vào emulator',
      () {
        final config = AppConfig.fromEnvironment();
        expect(config.env, AppEnv.local);
        expect(config.apiBaseUrl, 'http://10.0.2.2:3000');
      },
    );

    test('báo lỗi khi ENV hoặc URL sai, hoặc staging/production dùng http', () {
      for (final (url, env) in [
        ('https://api.example.vn', 'dev'),
        ('api.example.vn', 'local'),
        ('ftp://api.example.vn', 'local'),
        ('https://api.example.vn?x=1', 'local'),
        ('http://api.example.vn', 'staging'),
        ('http://api.example.vn', 'production'),
      ]) {
        expect(
          () => AppConfig.parse(apiBaseUrl: url, env: env),
          throwsArgumentError,
          reason: '$url $env',
        );
      }
    });
  });
}
