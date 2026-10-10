import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';

import '../../support/fake_auth.dart';

void main() {
  late FakeAuthRepository auth;

  Future<void> openLogin(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authRepositoryProvider.overrideWithValue(auth)],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Đăng nhập'), findsOneWidget);
  }

  Finder field(String label) => find.widgetWithText(TextFormField, label);

  setUp(() {
    auth = FakeAuthRepository(
      () async => null,
      onSignIn: (identifier, password) async => testUser,
    );
  });

  testWidgets('bỏ trống hoặc nhập sai dạng: báo lỗi, không gọi máy chủ', (
    tester,
  ) async {
    await openLogin(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Đăng nhập'));
    await tester.pump();
    expect(find.text('Nhập email hoặc số điện thoại'), findsOneWidget);
    expect(find.text('Nhập mật khẩu'), findsOneWidget);

    await tester.enterText(field('Email hoặc số điện thoại'), '090123');
    await tester.tap(find.widgetWithText(FilledButton, 'Đăng nhập'));
    await tester.pump();
    expect(find.text('Email hoặc số điện thoại chưa đúng'), findsOneWidget);
    expect(auth.signIns, isEmpty);
  });

  testWidgets('đăng nhập đúng: gửi số đã chuẩn hoá, vào trang chủ', (
    tester,
  ) async {
    await openLogin(tester);
    await tester.enterText(field('Email hoặc số điện thoại'), '090 123 4567');
    await tester.enterText(field('Mật khẩu'), 'mat-khau-dung');
    await tester.tap(find.widgetWithText(FilledButton, 'Đăng nhập'));
    await tester.pumpAndSettle();

    expect(auth.signIns, [('+84901234567', 'mat-khau-dung')]);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets('sai mật khẩu: hiện câu của máy chủ, ở lại màn đăng nhập', (
    tester,
  ) async {
    auth.onSignIn = (_, _) async => throw const ApiException(
      code: ErrorCodes.unauthenticated,
      message: 'Email/số điện thoại hoặc mật khẩu không đúng',
      statusCode: 401,
    );
    await openLogin(tester);
    await tester.enterText(field('Email hoặc số điện thoại'), 'an@demo.vn');
    await tester.enterText(field('Mật khẩu'), 'sai');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(
      find.text('Email/số điện thoại hoặc mật khẩu không đúng'),
      findsOneWidget,
    );
    expect(find.byType(NavigationBar), findsNothing);
    expect(auth.signIns, hasLength(1));
  });

  testWidgets('nút mắt hiện/ẩn mật khẩu', (tester) async {
    await openLogin(tester);
    EditableText password() => tester.widget<EditableText>(
      find.descendant(
        of: field('Mật khẩu'),
        matching: find.byType(EditableText),
      ),
    );
    expect(password().obscureText, isTrue);
    await tester.tap(find.byTooltip('Hiện mật khẩu'));
    await tester.pump();
    expect(password().obscureText, isFalse);
  });

  testWidgets('đăng xuất từ tab Tài khoản về màn đăng nhập', (tester) async {
    auth.onRestore = () async => testUser;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authRepositoryProvider.overrideWithValue(auth)],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tài khoản').last);
    await tester.pumpAndSettle();
    expect(find.text('Nguyễn Văn An'), findsOneWidget);

    await tester.tap(find.widgetWithText(ListTile, 'Đăng xuất'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Đăng xuất'));
    await tester.pumpAndSettle();

    expect(auth.signOutCalls, 1);
    expect(find.widgetWithText(FilledButton, 'Đăng nhập'), findsOneWidget);
  });

  testWidgets('phiên hết hạn giữa chừng: tự về màn đăng nhập', (tester) async {
    auth.onRestore = () async => testUser;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authRepositoryProvider.overrideWithValue(auth)],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);

    auth.expired.add(null);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Đăng nhập'), findsOneWidget);
  });
}
