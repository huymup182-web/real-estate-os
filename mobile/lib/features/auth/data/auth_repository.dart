import '../../../core/error/api_exception.dart';
import '../../../core/network/api_client.dart';
import '../../../core/storage/token_storage.dart';
import '../domain/current_user.dart';

/// Phiên đăng nhập: khôi phục từ token đã lưu. Đăng nhập, đăng xuất thêm ở TASK-116.
class AuthRepository {
  AuthRepository(this._api, this._tokens);

  final ApiClient _api;
  final TokenStorage _tokens;

  /// Người dùng của token đã lưu, hoặc null khi chưa đăng nhập. Token không còn dùng được (hết phiên, tài khoản
  /// bị khoá hay bị xoá) thì xoá token và trả null. Lỗi mạng, lỗi máy chủ thì ném [ApiException] để thử lại,
  /// giữ nguyên token.
  Future<CurrentUser?> restore() async {
    if (await _tokens.read() == null) {
      return null;
    }
    try {
      final response = await _api.get('/auth/me');
      return CurrentUser.fromJson(response.object);
    } on ApiException catch (error) {
      if (error.isUnauthenticated || error.code == ErrorCodes.forbidden) {
        await _tokens.clear();
        return null;
      }
      rethrow;
    }
  }
}
