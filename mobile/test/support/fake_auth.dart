import 'package:real_estate_os/features/auth/data/auth_repository.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';

/// AuthRepository giả: [restore] gọi [onRestore] (trả người dùng, null, hoặc ném lỗi).
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository(this.onRestore);

  Future<CurrentUser?> Function() onRestore;
  int restoreCalls = 0;

  @override
  Future<CurrentUser?> restore() {
    restoreCalls++;
    return onRestore();
  }
}

const testUser = CurrentUser(
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Nguyễn Văn An',
);
