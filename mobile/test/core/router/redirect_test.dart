import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';

void main() {
  const user = CurrentUser(id: 'u1', fullName: 'An');
  const signedIn = AsyncData(Session(user));
  const signedOut = AsyncData(Session(null));
  const loading = AsyncLoading<Session>();
  final failed = AsyncError<Session>(Exception('offline'), StackTrace.empty);

  test('đang kiểm phiên hoặc lỗi: về splash', () {
    expect(redirectFor(loading, '/home'), '/splash');
    expect(redirectFor(loading, '/splash'), isNull);
    expect(redirectFor(failed, '/login'), '/splash');
  });

  test('chưa đăng nhập: về màn đăng nhập', () {
    expect(redirectFor(signedOut, '/splash'), '/login');
    expect(redirectFor(signedOut, '/customers'), '/login');
    expect(redirectFor(signedOut, '/login'), isNull);
  });

  test('đã đăng nhập: splash/đăng nhập → trang chủ, còn lại giữ nguyên', () {
    expect(redirectFor(signedIn, '/splash'), '/home');
    expect(redirectFor(signedIn, '/login'), '/home');
    expect(redirectFor(signedIn, '/customers'), isNull);
  });
}
