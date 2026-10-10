import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/notifications/presentation/notifications_controller.dart';
import 'package:real_estate_os/features/profile/presentation/profile_screen.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_notifications.dart';

const _user = CurrentUser(
  id: 'u1',
  fullName: 'Nguyễn Văn An',
  email: 'an@demo.vn',
  phone: '+84901234567',
  companyName: 'Công ty BĐS Demo',
  roles: ['Môi giới', 'Trưởng nhóm'],
);

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được máy chủ',
);

void main() {
  late FakeAuthRepository auth;

  setUp(() {
    auth = FakeAuthRepository(() async => _user);
  });

  Future<void> open(
    WidgetTester tester, {
    Size size = const Size(1200, 3000),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(auth),
          notificationsRepositoryProvider.overrideWithValue(
            FakeNotificationsRepository(),
          ),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Tài khoản'),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> openPassword(WidgetTester tester) async {
    await tester.tap(find.text('Đổi mật khẩu'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Gửi mã'));
    await tester.pumpAndSettle();
  }

  Future<void> fill(
    WidgetTester tester, {
    String code = '123456',
    String password = 'MatKhauMoi1',
    String? confirm,
  }) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Mã xác nhận'),
      code,
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Mật khẩu mới'),
      password,
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Nhập lại mật khẩu mới'),
      confirm ?? password,
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Đổi mật khẩu'));
    await tester.pumpAndSettle();
  }

  test('chữ viết tắt của họ tên', () {
    expect(initials('Nguyễn Văn An'), 'NA');
    expect(initials('  an '), 'A');
    expect(initials(''), '?');
  });

  testWidgets('hiện hồ sơ: tên, công ty, email, số điện thoại, vai trò', (
    tester,
  ) async {
    await open(tester);
    expect(find.text('NA'), findsOneWidget);
    expect(find.text('Nguyễn Văn An'), findsOneWidget);
    expect(find.text('Công ty BĐS Demo'), findsNWidgets(2));
    expect(find.text('an@demo.vn'), findsOneWidget);
    expect(find.text('0901 234 567'), findsOneWidget);
    expect(find.text('Môi giới, Trưởng nhóm'), findsOneWidget);
    expect(find.text('Đổi mật khẩu'), findsOneWidget);
    expect(find.text('Đăng xuất'), findsOneWidget);
  });

  testWidgets('tài khoản không có email: không có đổi mật khẩu', (
    tester,
  ) async {
    auth = FakeAuthRepository(
      () async => const CurrentUser(
        id: 'u2',
        fullName: 'Trần Bình',
        phone: '+84901234567',
      ),
    );
    await open(tester);
    expect(find.text('Đổi mật khẩu'), findsNothing);
    expect(find.text('—'), findsNWidgets(3));
  });

  testWidgets('kéo xuống: đọc lại hồ sơ; lỗi thì giữ hồ sơ, báo lỗi', (
    tester,
  ) async {
    auth.onMe = () async => const CurrentUser(
      id: 'u1',
      fullName: 'Nguyễn Văn Anh',
      email: 'an@demo.vn',
    );
    await open(tester);
    await tester.fling(find.text('Thông tin'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Nguyễn Văn Anh'), findsOneWidget);

    auth.onMe = () async => throw _offline;
    await tester.fling(find.text('Thông tin'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Nguyễn Văn Anh'), findsOneWidget);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
  });

  testWidgets('đổi mật khẩu: gửi mã, nhập mã và mật khẩu mới, về đăng nhập', (
    tester,
  ) async {
    await open(tester);
    await tester.tap(find.text('Đổi mật khẩu'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Đổi mật khẩu'), findsOneWidget);
    expect(
      find.text('Mã xác nhận 6 số sẽ được gửi tới an@demo.vn.'),
      findsOneWidget,
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Gửi mã'));
    await tester.pumpAndSettle();
    expect(auth.resetRequests, ['an@demo.vn']);
    expect(
      find.text('Đã gửi mã 6 số tới an@demo.vn. Mã có hiệu lực trong 15 phút.'),
      findsOneWidget,
    );

    await fill(tester);
    expect(auth.resets, [('an@demo.vn', '123456', 'MatKhauMoi1')]);
    expect(auth.signOutCalls, 1);
    expect(find.text('Đăng nhập'), findsWidgets);
    expect(
      find.text('Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.'),
      findsOneWidget,
    );
  });

  testWidgets('kiểm tra form: mã 6 số, mật khẩu ≥ 8 ký tự, nhập lại khớp', (
    tester,
  ) async {
    await open(tester);
    await openPassword(tester);
    await fill(tester, code: '12a4', password: 'ngan', confirm: 'khac');
    expect(find.text('Nhập đủ 6 số trong email'), findsOneWidget);
    expect(find.text('Mật khẩu cần ít nhất 8 ký tự'), findsOneWidget);
    expect(find.text('Hai mật khẩu chưa khớp'), findsOneWidget);
    expect(auth.resets, isEmpty);
    expect(auth.signOutCalls, 0);
  });

  testWidgets('mã sai: báo lỗi của máy chủ, vẫn đăng nhập', (tester) async {
    auth.onReset = (email, code, password) async => throw const ApiException(
      code: ErrorCodes.validationError,
      message: 'Mã không đúng hoặc đã hết hạn',
      details: [
        FieldError(field: 'code', message: 'Mã không đúng hoặc đã hết hạn'),
      ],
    );
    await open(tester);
    await openPassword(tester);
    await fill(tester);
    expect(find.text('Mã không đúng hoặc đã hết hạn'), findsOneWidget);
    expect(auth.signOutCalls, 0);
    expect(find.widgetWithText(AppBar, 'Đổi mật khẩu'), findsOneWidget);

    // Gửi lại mã.
    await tester.tap(find.text('Gửi lại mã'));
    await tester.pumpAndSettle();
    expect(auth.resetRequests, hasLength(2));
  });

  testWidgets('lỗi gửi mã: báo lỗi, bấm gửi lại được', (tester) async {
    auth.onRequestReset = (email) async => throw _offline;
    await open(tester);
    await openPassword(tester);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Gửi mã'), findsOneWidget);
  });

  testWidgets('đăng xuất cần xác nhận', (tester) async {
    await open(tester);
    await tester.tap(find.text('Đăng xuất'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Huỷ'));
    await tester.pumpAndSettle();
    expect(auth.signOutCalls, 0);
    await tester.tap(find.text('Đăng xuất'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Đăng xuất'));
    await tester.pumpAndSettle();
    expect(auth.signOutCalls, 1);
  });

  testWidgets('màn hình hẹp, chữ to: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, size: const Size(960, 2400)); // 320 x 800.
    expect(tester.takeException(), isNull);
    await openPassword(tester);
    expect(tester.takeException(), isNull);
  });
}
