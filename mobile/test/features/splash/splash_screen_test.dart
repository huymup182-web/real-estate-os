import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';

import '../../support/fake_auth.dart';

void main() {
  Widget app(FakeAuthRepository auth) => ProviderScope(
    overrides: [authRepositoryProvider.overrideWithValue(auth)],
    child: const App(),
  );

  testWidgets('đang kiểm phiên: hiện logo, tên app, vòng chờ', (tester) async {
    final pending = Completer<CurrentUser?>();
    await tester.pumpWidget(app(FakeAuthRepository(() => pending.future)));
    await tester.pump();

    expect(find.text('Real Estate OS'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);

    pending.complete(testUser);
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets('đã đăng nhập: vào trang chủ', (tester) async {
    await tester.pumpWidget(app(FakeAuthRepository(() async => testUser)));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Trang chủ'), findsOneWidget);
  });

  testWidgets('chưa đăng nhập: vào màn đăng nhập', (tester) async {
    await tester.pumpWidget(app(FakeAuthRepository(() async => null)));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Đăng nhập'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });

  testWidgets('lỗi mạng: hiện lỗi và nút thử lại; thử lại được thì vào app', (
    tester,
  ) async {
    var online = false;
    final auth = FakeAuthRepository(() async {
      if (!online) {
        throw const ApiException(
          code: ErrorCodes.networkError,
          message: 'Không kết nối được máy chủ, vui lòng kiểm tra mạng',
        );
      }
      return testUser;
    });
    await tester.pumpWidget(app(auth));
    await tester.pumpAndSettle();

    expect(
      find.text('Không kết nối được máy chủ, vui lòng kiểm tra mạng'),
      findsOneWidget,
    );
    online = true;
    await tester.tap(find.widgetWithText(FilledButton, 'Thử lại'));
    await tester.pumpAndSettle();

    expect(auth.restoreCalls, 2);
    expect(find.byType(NavigationBar), findsOneWidget);
  });
}
