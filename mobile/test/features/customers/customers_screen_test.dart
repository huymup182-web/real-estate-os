import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/core/widgets/debounced_search_field.dart';
import 'package:real_estate_os/features/customers/domain/customer_query.dart';
import 'package:real_estate_os/features/customers/presentation/customer_list_controller.dart';
import 'package:real_estate_os/features/customers/presentation/customers_screen.dart';

import '../../support/fake_customers.dart';

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được máy chủ',
);

/// Vùng cuộn dọc của danh sách (ô tìm kiếm và hàng bước có Scrollable riêng).
final _list = find.byWidgetPredicate(
  (widget) =>
      widget is Scrollable && widget.axisDirection == AxisDirection.down,
);

void main() {
  late FakeCustomersRepository repository;

  CustomerQuery lastQuery() => repository.listedQueries.last;

  Future<void> open(
    WidgetTester tester, {
    Size size = const Size(1200, 2400),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [customersRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const CustomersScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapChip(WidgetTester tester, String label) async {
    final chip = find.widgetWithText(FilterChip, label);
    await tester.ensureVisible(chip);
    await tester.pumpAndSettle();
    await tester.tap(chip);
    await tester.pumpAndSettle();
  }

  testWidgets('hiện tổng số và thẻ khách: tên, số điện thoại, bước, nhu cầu', (
    tester,
  ) async {
    repository = FakeCustomersRepository(
      (page) async =>
          customerPage([customer(1), customer(2, status: 'WON')], total: 2),
    );
    await open(tester);
    expect(find.text('2 khách'), findsOneWidget);
    expect(find.text('Khách số 1'), findsOneWidget);
    expect(find.text('0901 234 561'), findsOneWidget);
    // "Mới", "Chốt thành công" có cả ở hàng lọc và trên thẻ.
    expect(find.text('Mới'), findsNWidgets(2));
    expect(find.text('Chốt thành công'), findsNWidgets(2));
    expect(find.text('Để ở · Trong 3 tháng · Zalo'), findsNWidgets(2));
    // 20:00 UTC ngày 08 là 03:00 ngày 09 giờ Việt Nam.
    expect(find.text('Tạo 09/10/2026'), findsNWidgets(2));
    expect(repository.listedPages, [1]);
  });

  testWidgets('gõ tìm: chờ ngừng gõ mới tìm, tìm lại từ trang đầu', (
    tester,
  ) async {
    repository = FakeCustomersRepository(
      (page) async => lastQuery().keyword.isEmpty
          ? customerPage([customer(1), customer(2)], total: 2)
          : customerPage([customer(2)], total: 1),
    );
    await open(tester);
    await tester.enterText(find.byType(TextField), 'Khách 2');
    await tester.pump(const Duration(milliseconds: 200));
    expect(repository.listedQueries, hasLength(1));
    await tester.pump(DebouncedSearchField.debounce);
    await tester.pumpAndSettle();
    expect(lastQuery().keyword, 'Khách 2');
    expect(find.text('1 kết quả'), findsOneWidget);
    expect(find.text('Khách số 1'), findsNothing);

    await tester.tap(find.byTooltip('Xoá tìm kiếm'));
    await tester.pumpAndSettle();
    expect(lastQuery(), const CustomerQuery());
    expect(find.text('2 khách'), findsOneWidget);
  });

  testWidgets('lọc theo bước: chọn nhiều; "Tất cả" bỏ lọc', (tester) async {
    repository = FakeCustomersRepository(
      (page) async => customerPage([customer(1)], total: 1),
    );
    await open(tester);
    await tapChip(tester, 'Đi xem nhà');
    await tapChip(tester, 'Đặt cọc');
    expect(lastQuery().statuses, {'VIEWING', 'DEPOSIT'});
    expect(
      tester
          .widget<FilterChip>(find.widgetWithText(FilterChip, 'Tất cả'))
          .selected,
      isFalse,
    );
    await tapChip(tester, 'Đi xem nhà');
    expect(lastQuery().statuses, {'DEPOSIT'});

    await tapChip(tester, 'Tất cả');
    expect(lastQuery(), const CustomerQuery());
    expect(repository.listedPages, everyElement(1));
  });

  testWidgets('trống: báo theo từ khoá, bước, hoặc chưa có khách', (
    tester,
  ) async {
    repository = FakeCustomersRepository();
    await open(tester);
    expect(find.text('Chưa có khách hàng nào.'), findsOneWidget);

    await tapChip(tester, 'Mất khách');
    expect(find.text('Không có khách nào ở bước đã chọn.'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'xyz');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('Không tìm thấy khách khớp "xyz".'), findsOneWidget);
  });

  testWidgets('cuộn tới cuối thì tải trang sau', (tester) async {
    repository = FakeCustomersRepository(
      (page) async => customerPage(
        [for (var i = 1; i <= 20; i++) customer((page - 1) * 20 + i)],
        page: page,
        total: 40,
      ),
    );
    await open(tester);
    await tester.scrollUntilVisible(
      find.text('Khách số 40'),
      500,
      scrollable: _list,
    );
    await tester.pumpAndSettle();
    expect(repository.listedPages, [1, 2]);
  });

  testWidgets('lỗi tải: thử lại được; lỗi khi kéo tải lại: giữ danh sách', (
    tester,
  ) async {
    var calls = 0;
    repository = FakeCustomersRepository((page) async {
      calls++;
      if (calls == 1 || calls == 3) {
        throw _offline;
      }
      return customerPage([customer(calls)], total: 1);
    });
    await open(tester);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Khách số 2'), findsOneWidget);

    await tester.fling(find.text('1 khách'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Khách số 2'), findsOneWidget);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    repository = FakeCustomersRepository(
      (page) async =>
          customerPage([customer(1, status: 'QUALIFIED')], total: 1),
    );
    await open(tester, size: const Size(960, 2000));
    expect(find.text('Khách số 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
