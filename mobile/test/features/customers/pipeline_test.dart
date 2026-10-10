import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/customers/presentation/customer_list_controller.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_customers.dart';
import '../../support/fake_locations.dart';

final _editor = CurrentUser(
  id: testUser.id,
  fullName: testUser.fullName,
  permissions: const {'customer.view': 'OWN', 'customer.edit': 'OWN'},
);

void main() {
  late FakeCustomersRepository repository;
  var user = _editor;

  setUp(() {
    user = _editor;
    repository = FakeCustomersRepository(
      (page) async => customerPage([customer(1)], total: 1),
    );
  });

  Future<void> open(
    WidgetTester tester, {
    String location = AppRoutes.customers,
    Size size = const Size(1200, 4000),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => user),
          ),
          customersRepositoryProvider.overrideWithValue(repository),
          locationsRepositoryProvider.overrideWithValue(
            FakeLocationsRepository(),
          ),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    GoRouter.of(tester.element(find.byType(NavigationBar))).go(location);
    await tester.pumpAndSettle();
  }

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.text('Đổi bước'));
    await tester.pumpAndSettle();
  }

  Future<void> pick(WidgetTester tester, String label) async {
    final option = find.widgetWithText(RadioListTile<String>, label);
    await tester.ensureVisible(option);
    await tester.pumpAndSettle();
    await tester.tap(option);
    await tester.pumpAndSettle();
  }

  Future<void> save(WidgetTester tester) async {
    final button = find.widgetWithText(FilledButton, 'Lưu');
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  testWidgets(
    'pipeline: số khách từng bước; chạm bước thì về danh sách lọc bước đó',
    (tester) async {
      await open(tester);
      await tester.tap(find.byTooltip('Pipeline'));
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(AppBar, 'Pipeline khách hàng'),
        findsOneWidget,
      );
      expect(
        find.text('11 khách · Chạm một bước để xem danh sách'),
        findsOneWidget,
      );
      final bars = tester
          .widgetList<LinearProgressIndicator>(
            find.byType(LinearProgressIndicator),
          )
          .map((bar) => bar.value)
          .toList();
      expect(bars, [1, 0.5, 0, 0.25, 0, 0, 0.75, 0.25]);

      await tester.tap(find.text('Chốt thành công'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(AppBar, 'Khách hàng'), findsOneWidget);
      expect(repository.listedQueries.last.statuses, {'WON'});
      expect(
        tester
            .widget<FilterChip>(
              find.widgetWithText(FilterChip, 'Chốt thành công'),
            )
            .selected,
        isTrue,
      );
    },
  );

  testWidgets('chọn bước cuối từ pipeline: hàng nút cuộn tới nút đang chọn', (
    tester,
  ) async {
    await open(tester, size: const Size(960, 2400));
    await tester.tap(find.byTooltip('Pipeline'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mất khách'));
    await tester.pumpAndSettle();
    final chip = tester.getRect(find.widgetWithText(FilterChip, 'Mất khách'));
    expect(chip.left, greaterThanOrEqualTo(0));
    expect(chip.right, lessThanOrEqualTo(320));
  });

  testWidgets('pipeline lỗi: thử lại được', (tester) async {
    var fail = true;
    repository.onPipeline = () async {
      if (fail) {
        throw const ApiException(
          code: ErrorCodes.networkError,
          message: 'Không kết nối được máy chủ',
        );
      }
      return const [(status: 'NEW', count: 1)];
    };
    await open(tester, location: AppRoutes.customerPipeline);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(
      find.text('1 khách · Chạm một bước để xem danh sách'),
      findsOneWidget,
    );
  });

  testWidgets('không có customer.edit thì không có nút đổi bước', (
    tester,
  ) async {
    user = testUser;
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(find.text('Trần Thị Bình'), findsWidgets);
    expect(find.text('Đổi bước'), findsNothing);
  });

  testWidgets('đổi bước: gửi bước mới kèm updatedAt, tải lại, báo', (
    tester,
  ) async {
    var status = 'VIEWING';
    repository
      ..onDetail = ((id) async => customerDetail(id, status: status))
      ..onChangeStatus = (id, next, reason) async {
        status = next;
        return customerDetail(id, status: next);
      };
    await open(tester, location: AppRoutes.customerDetail('c1'));
    await openSheet(tester);
    // Chưa đổi thì chưa lưu được.
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Lưu'))
          .onPressed,
      isNull,
    );
    await pick(tester, 'Đặt cọc');
    await save(tester);

    expect(repository.statusChanges.single.status, 'DEPOSIT');
    expect(repository.statusChanges.single.lostReason, isNull);
    expect(
      repository.statusChanges.single.expected,
      DateTime.utc(2026, 10, 8, 3),
    );
    expect(find.text('Đã chuyển sang bước "Đặt cọc".'), findsOneWidget);
    expect(repository.detailCalls, ['c1', 'c1']);
    expect(repository.activityPages, [1, 1]);
    expect(
      find.descendant(
        of: find.byType(ListView),
        matching: find.text('Đặt cọc'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('sang mất khách: bắt buộc lý do', (tester) async {
    await open(tester, location: AppRoutes.customerDetail('c1'));
    await openSheet(tester);
    await pick(tester, 'Mất khách');
    await save(tester);
    expect(find.text('Nhập lý do mất khách'), findsOneWidget);
    expect(repository.statusChanges, isEmpty);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Lý do mất khách'),
      '  Mua chỗ khác  ',
    );
    await tester.pump();
    await save(tester);
    expect(repository.statusChanges.single.status, 'LOST');
    expect(repository.statusChanges.single.lostReason, 'Mua chỗ khác');
    expect(find.text('Đã chuyển sang bước "Mất khách".'), findsOneWidget);
  });

  testWidgets('người khác vừa sửa (409): báo, tải lại chi tiết', (
    tester,
  ) async {
    repository.onChangeStatus = (id, status, reason) async =>
        throw const ApiException(
          code: ErrorCodes.conflict,
          message: 'Đã bị sửa',
          statusCode: 409,
        );
    await open(tester, location: AppRoutes.customerDetail('c1'));
    await openSheet(tester);
    await pick(tester, 'Chốt thành công');
    await save(tester);
    expect(
      find.text(
        'Khách vừa được người khác cập nhật. Đã tải lại, vui lòng thử lại.',
      ),
      findsOneWidget,
    );
    expect(repository.detailCalls, ['c1', 'c1']);
  });

  testWidgets('lỗi khác (không có quyền): báo lỗi của máy chủ', (tester) async {
    repository.onChangeStatus = (id, status, reason) async =>
        throw const ApiException(
          code: ErrorCodes.forbidden,
          message: 'Bạn không có quyền sửa khách này',
          statusCode: 403,
        );
    await open(tester, location: AppRoutes.customerDetail('c1'));
    await openSheet(tester);
    await pick(tester, 'Mới');
    await save(tester);
    expect(find.text('Bạn không có quyền sửa khách này'), findsOneWidget);
    expect(repository.detailCalls, ['c1']);
  });

  testWidgets(
    'màn hẹp 320px, chữ to 1.3: pipeline và bảng đổi bước không tràn',
    (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 1.3;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await open(
        tester,
        location: AppRoutes.customerPipeline,
        size: const Size(960, 2000),
      );
      expect(find.text('Có nhu cầu thật'), findsOneWidget);
      GoRouter.of(tester.element(find.byType(NavigationBar)))
          .go(AppRoutes.customerDetail('c1'));
      await tester.pumpAndSettle();
      await openSheet(tester);
      await pick(tester, 'Mất khách');
      expect(tester.takeException(), isNull);
    },
  );
}
