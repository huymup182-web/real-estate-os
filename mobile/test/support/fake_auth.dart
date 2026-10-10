import 'dart:async';

import 'package:real_estate_os/features/auth/data/auth_repository.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';

/// AuthRepository giả: [restore] gọi [onRestore], [signIn] gọi [onSignIn] (trả người dùng hoặc ném lỗi).
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository(this.onRestore, {this.onSignIn});

  Future<CurrentUser?> Function() onRestore;
  Future<CurrentUser> Function(String identifier, String password)? onSignIn;
  int restoreCalls = 0;
  int signOutCalls = 0;
  final signIns = <(String, String)>[];
  final expired = StreamController<void>.broadcast();

  @override
  Stream<void> get sessionExpired => expired.stream;

  @override
  Future<CurrentUser?> restore() {
    restoreCalls++;
    return onRestore();
  }

  @override
  Future<CurrentUser> signIn({
    required String identifier,
    required String password,
  }) {
    signIns.add((identifier, password));
    return onSignIn!(identifier, password);
  }

  @override
  Future<void> signOut() async => signOutCalls++;

  Future<CurrentUser> Function()? onMe;
  Future<int> Function(String email)? onRequestReset;
  Future<void> Function(String email, String code, String password)? onReset;
  final resetRequests = <String>[];
  final resets = <(String, String, String)>[];

  @override
  Future<CurrentUser> me() => onMe!();

  @override
  Future<int> requestPasswordReset(String email) {
    resetRequests.add(email);
    return onRequestReset?.call(email) ?? Future.value(900);
  }

  @override
  Future<void> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) {
    resets.add((email, code, newPassword));
    return onReset?.call(email, code, newPassword) ?? Future.value();
  }
}

const testUser = CurrentUser(
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Nguyễn Văn An',
  companyName: 'Công ty BĐS Demo',
  email: 'an@demo.vn',
);
