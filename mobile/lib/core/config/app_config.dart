/// Môi trường chạy app, truyền bằng `--dart-define=ENV=...`.
enum AppEnv { local, staging, production }

/// Cấu hình app đọc lúc build bằng `--dart-define` (không có secret: mobile chỉ gọi Backend API).
///
/// - `API_BASE_URL`: gốc backend, vd `https://api.example.vn`. Mặc định `http://10.0.2.2:3000` là máy chạy
///   emulator Android khi backend chạy local.
/// - `ENV`: `local` (mặc định), `staging` hoặc `production`.
class AppConfig {
  const AppConfig({required this.apiBaseUrl, required this.env});

  /// Đọc từ `--dart-define`; giá trị sai thì báo lỗi ngay khi mở app thay vì gọi sai địa chỉ.
  factory AppConfig.fromEnvironment() => AppConfig.parse(
    apiBaseUrl: const String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://10.0.2.2:3000',
    ),
    env: const String.fromEnvironment('ENV', defaultValue: 'local'),
  );

  /// Kiểm và chuẩn hoá: URL phải là http(s) có host, bỏ `/` cuối; ngoài `local` bắt buộc https.
  factory AppConfig.parse({required String apiBaseUrl, required String env}) {
    final appEnv = AppEnv.values
        .where((value) => value.name == env)
        .firstOrNull;
    if (appEnv == null) {
      throw ArgumentError.value(
        env,
        'ENV',
        'phải là local, staging hoặc production',
      );
    }
    final trimmed = apiBaseUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    final uri = Uri.tryParse(trimmed);
    if (uri == null ||
        !(uri.scheme == 'http' || uri.scheme == 'https') ||
        uri.host.isEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw ArgumentError.value(
        apiBaseUrl,
        'API_BASE_URL',
        'phải là URL http(s) đầy đủ',
      );
    }
    if (appEnv != AppEnv.local && uri.scheme != 'https') {
      throw ArgumentError.value(
        apiBaseUrl,
        'API_BASE_URL',
        'ngoài local phải dùng https',
      );
    }
    return AppConfig(apiBaseUrl: trimmed, env: appEnv);
  }

  final String apiBaseUrl;
  final AppEnv env;

  /// Gốc REST API (phase0/05-API-CONVENTIONS.md): `<API_BASE_URL>/api/v1`.
  String get apiUrl => '$apiBaseUrl/api/v1';

  bool get isProduction => env == AppEnv.production;
}
