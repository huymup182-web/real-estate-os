import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/auth_repository.dart';
import '../domain/current_user.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    ref.watch(apiClientProvider),
    ref.watch(tokenStorageProvider),
  ),
);

/// Trạng thái đăng nhập của app: `user == null` là chưa đăng nhập.
class Session {
  const Session(this.user);

  final CurrentUser? user;

  bool get isAuthenticated => user != null;
}

/// Phiên đăng nhập. Lúc mở app: đang tải (màn splash) → có người dùng hoặc chưa đăng nhập; lỗi mạng thì splash
/// hiện nút thử lại ([SessionController.retry]); không để Riverpod tự thử lại.
final sessionProvider = AsyncNotifierProvider<SessionController, Session>(
  SessionController.new,
  retry: (_, _) => null,
);

class SessionController extends AsyncNotifier<Session> {
  @override
  Future<Session> build() async =>
      Session(await ref.read(authRepositoryProvider).restore());

  Future<void> retry() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }
}
