import '../../../core/error/api_exception.dart';
import '../../../core/network/api_client.dart';
import '../../../core/storage/token_storage.dart';
import '../domain/current_user.dart';

/// Đăng nhập, khôi phục phiên từ token đã lưu, đăng xuất.
class AuthRepository {
  AuthRepository(this._api, this._tokens);

  final ApiClient _api;
  final TokenStorage _tokens;

  /// Phát khi phiên hết hạn giữa chừng (không làm mới được token).
  Stream<void> get sessionExpired => _api.sessionExpired;

  /// Người dùng của token đã lưu, hoặc null khi chưa đăng nhập. Token không còn dùng được (hết phiên, tài khoản
  /// bị khoá hay bị xoá) thì xoá token và trả null. Lỗi mạng, lỗi máy chủ thì ném [ApiException] để thử lại,
  /// giữ nguyên token.
  Future<CurrentUser?> restore() async {
    if (await _tokens.read() == null) {
      return null;
    }
    try {
      return await _me();
    } on ApiException catch (error) {
      if (error.isUnauthenticated || error.code == ErrorCodes.forbidden) {
        await _tokens.clear();
        return null;
      }
      rethrow;
    }
  }

  /// `POST /auth/login` (`identifier` đã chuẩn hoá), lưu token rồi đọc quyền từ `/auth/me`. Sai thông tin → 401,
  /// tài khoản bị khoá → 403, ném [ApiException] với câu thông báo của backend.
  Future<CurrentUser> signIn({
    required String identifier,
    required String password,
  }) async {
    final response = await _api.post(
      '/auth/login',
      body: {'identifier': identifier, 'password': password},
      auth: false,
    );
    final data = response.object;
    await _tokens.save(
      AuthTokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      ),
    );
    try {
      return await _me();
    } on ApiException {
      await _tokens.clear();
      rethrow;
    }
  }

  /// `POST /auth/logout` (thu hồi phiên trên máy chủ) rồi xoá token. Lỗi khi gọi máy chủ (mất mạng, phiên đã hết)
  /// vẫn xoá token trên máy: người dùng bấm đăng xuất thì luôn được đăng xuất.
  Future<void> signOut() async {
    if (await _tokens.read() != null) {
      try {
        await _api.post('/auth/logout');
      } on ApiException {
        // Bỏ qua: refresh token còn lại trên máy chủ tự hết hạn sau 30 ngày.
      }
    }
    await _tokens.clear();
  }

  Future<CurrentUser> _me() async =>
      CurrentUser.fromJson((await _api.get('/auth/me')).object);
}
