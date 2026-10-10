import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/clock.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/customers/presentation/customer_list_controller.dart';
import 'package:real_estate_os/features/notifications/presentation/notifications_controller.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_customers.dart';
import '../../support/fake_notifications.dart';

const _customerId = '7d3c1f9e-2b4a-4c6d-8e0f-1a2b3c4d5e6f';

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được máy chủ',
);

final _user = CurrentUser(
  id: testUser.id,
  fullName: testUser.fullName,
  permissions: const {'customer.view': 'OWN'},
);

void main() {
  // 08:00 ngày 16/10/2026 giờ Việt Nam.
  final now = DateTime.utc(2026, 10, 16, 1);
  late FakeNotificationsRepository repository;

  setUp(() {
    repository = FakeNotificationsRepository([
      notification(1),
      notification(
        2,
        type: 'CUSTOMER_ASSIGNED',
        data: {'customerId': _customerId},
      ),
      notification(3, readAt: DateTime.utc(2026, 10, 15)),
      notification(4, type: 'NEW_LEAD'),
    ]);
  });

  Future<void> open(
    WidgetTester tester, {
    Size size = const Size(1200, 4000),
    bool openTab = true,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => _user),
          ),
          notificationsRepositoryProvider.overrideWithValue(repository),
          customersRepositoryProvider.overrideWithValue(
            FakeCustomersRepository(),
          ),
          clockProvider.overrideWithValue(() => now),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    if (openTab) {
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text('Thông báo'),
        ),
      );
      await tester.pumpAndSettle();
    }
  }

  Finder badge(String label) =>
      find.descendant(of: find.byType(Badge), matching: find.text(label));

  testWidgets('tab có số chưa đọc; mở tab thấy hộp thư mới nhất trước', (
    tester,
  ) async {
    await open(tester, openTab: false);
    expect(badge('3'), findsOneWidget);

    await tester.tap(find.byTooltip('Thông báo, 3 chưa đọc'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Thông báo'), findsOneWidget);
    expect(find.text('3 chưa đọc'), findsOneWidget);
    expect(find.text('Thông báo 1'), findsOneWidget);
    expect(find.text('Nội dung 1'), findsOneWidget);
    expect(find.text('07:00 Hôm nay · Hệ thống'), findsOneWidget);
    expect(find.text('06:00 Hôm nay · Được giao khách'), findsOneWidget);
    expect(find.text('07:00 Hôm qua · Hệ thống'), findsNothing);
    expect(find.byKey(const Key('unread-dot')), findsNWidgets(3));
    expect(
      tester.getTopLeft(find.text('Thông báo 1')).dy,
      lessThan(tester.getTopLeft(find.text('Thông báo 4')).dy),
    );
    expect(repository.listCalls.last, (page: 1, unreadOnly: false));
  });

  testWidgets('chạm thông báo không có liên kết: đánh dấu đã đọc tại chỗ', (
    tester,
  ) async {
    await open(tester);
    await tester.tap(find.text('Thông báo 1'));
    await tester.pumpAndSettle();
    expect(repository.markedRead, ['n1']);
    expect(find.text('2 chưa đọc'), findsOneWidget);
    expect(badge('2'), findsOneWidget);
    expect(find.byKey(const Key('unread-dot')), findsNWidgets(2));
    expect(find.widgetWithText(AppBar, 'Thông báo'), findsOneWidget);

    // Đã đọc rồi thì chạm lại không gọi API nữa.
    await tester.tap(find.text('Thông báo 1'));
    await tester.pumpAndSettle();
    expect(repository.markedRead, ['n1']);
  });

  testWidgets('chạm thông báo giao khách: mở chi tiết khách, đã đọc', (
    tester,
  ) async {
    await open(tester);
    await tester.tap(find.text('Thông báo 2'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Trần Thị Bình'), findsOneWidget);
    expect(repository.markedRead, ['n2']);
    expect(badge('2'), findsOneWidget);
  });

  testWidgets('lọc chưa đọc; hết thì báo trống', (tester) async {
    await open(tester);
    await tester.tap(find.widgetWithText(FilterChip, 'Chưa đọc'));
    await tester.pumpAndSettle();
    expect(repository.listCalls.last, (page: 1, unreadOnly: true));
    expect(find.text('Thông báo 3'), findsNothing);
    expect(find.text('Thông báo 4'), findsOneWidget);

    repository.items = [notification(3, readAt: DateTime.utc(2026, 10, 15))];
    await tester.fling(find.text('Thông báo 1'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Không có thông báo chưa đọc.'), findsOneWidget);
    expect(find.text('0 chưa đọc'), findsOneWidget);
  });

  testWidgets('đánh dấu đã đọc tất cả', (tester) async {
    await open(tester);
    await tester.tap(find.byTooltip('Đánh dấu đã đọc tất cả'));
    await tester.pumpAndSettle();
    expect(repository.markAllCalls, 1);
    expect(find.text('Đã đánh dấu đọc 3 thông báo.'), findsOneWidget);
    expect(find.text('0 chưa đọc'), findsOneWidget);
    expect(find.byTooltip('Đánh dấu đã đọc tất cả'), findsNothing);
    expect(find.byType(Badge), findsNothing);
    expect(find.byKey(const Key('unread-dot')), findsNothing);
  });

  testWidgets('lỗi đánh dấu: trả lại chưa đọc, báo lỗi', (tester) async {
    repository.failMarkRead = _offline;
    await open(tester);
    await tester.tap(find.text('Thông báo 1'));
    await tester.pumpAndSettle();
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    expect(find.byKey(const Key('unread-dot')), findsNWidgets(3));

    repository.failMarkAll = _offline;
    await tester.tap(find.byTooltip('Đánh dấu đã đọc tất cả'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('unread-dot')), findsNWidgets(3));
  });

  testWidgets('lỗi tải hộp thư: hiện lỗi, thử lại', (tester) async {
    repository.failList = _offline;
    await open(tester);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);

    repository.failList = null;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Thông báo 1'), findsOneWidget);
  });

  testWidgets('nhiều trang: cuộn tới cuối thì tải thêm', (tester) async {
    repository = FakeNotificationsRepository([
      for (var index = 1; index <= 25; index++) notification(index),
    ]);
    await open(tester, size: const Size(1200, 2400));
    expect(find.text('Thông báo 25'), findsNothing);
    await tester.scrollUntilVisible(
      find.text('Thông báo 25'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    expect(find.text('Thông báo 25'), findsOneWidget);
    expect(repository.listCalls.map((call) => call.page), [1, 2]);
  });

  testWidgets('chưa có thông báo', (tester) async {
    repository = FakeNotificationsRepository();
    await open(tester);
    expect(find.text('Chưa có thông báo nào.'), findsOneWidget);
    expect(find.byType(Badge), findsNothing);
  });

  testWidgets('quay lại tab thông báo thì tải lại hộp thư', (tester) async {
    await open(tester);
    final calls = repository.listCalls.length;
    repository.items = [notification(9), ...repository.items];
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Trang chủ'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Thông báo'),
      ),
    );
    await tester.pumpAndSettle();
    expect(repository.listCalls.length, calls + 1);
    expect(find.text('Thông báo 9'), findsOneWidget);
    expect(badge('4'), findsOneWidget);
  });

  testWidgets('màn hình hẹp, chữ to: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, size: const Size(960, 2400)); // 320 x 800.
    expect(tester.takeException(), isNull);
    expect(find.text('Thông báo 1'), findsOneWidget);
  });
}
