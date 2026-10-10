import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/network/api_response.dart';
import 'package:real_estate_os/core/network/page.dart' as api;
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/customers/domain/customer_detail.dart';
import 'package:real_estate_os/features/customers/presentation/customer_list_controller.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_customers.dart';
import '../../support/fake_locations.dart';

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được máy chủ',
);

void main() {
  late FakeCustomersRepository repository;
  var user = testUser;

  setUp(() {
    user = testUser;
    repository = FakeCustomersRepository(
      (page) async => customerPage([customer(1)], total: 1),
    );
  });

  /// Mở app ở tab Khách hàng, hoặc thẳng [location].
  Future<void> open(
    WidgetTester tester, {
    String location = AppRoutes.customers,
    Size size = const Size(1200, 6000),
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

  Finder info(String label) =>
      find.ancestor(of: find.text(label), matching: find.byType(Row));

  String valueOf(WidgetTester tester, String label) {
    final texts = tester
        .widgetList<Text>(
          find.descendant(of: info(label).first, matching: find.byType(Text)),
        )
        .map((text) => text.data)
        .toList();
    if (texts.length > 1) {
      return texts.last!;
    }
    return tester
        .widget<SelectableText>(
          find.descendant(
            of: info(label).first,
            matching: find.byType(SelectableText),
          ),
        )
        .data!;
  }

  testWidgets('chạm thẻ trong danh sách mở chi tiết: thông tin, ghi chú', (
    tester,
  ) async {
    await open(tester);
    await tester.tap(find.text('Khách số 1'));
    await tester.pumpAndSettle();
    expect(repository.detailCalls, ['c1']);
    expect(find.widgetWithText(AppBar, 'Trần Thị Bình'), findsOneWidget);
    expect(find.text('Đi xem nhà'), findsOneWidget);
    expect(valueOf(tester, 'Điện thoại'), '0901 234 567');
    expect(valueOf(tester, 'Email'), 'binh@example.vn');
    expect(valueOf(tester, 'Mục đích'), 'Đầu tư');
    expect(valueOf(tester, 'Thời gian mua'), 'Mua ngay');
    expect(valueOf(tester, 'Nguồn khách'), 'Giới thiệu');
    expect(valueOf(tester, 'Môi giới'), 'Chưa giao');
    expect(valueOf(tester, 'Ngày tạo'), '01/10/2026');
    expect(find.text('Lý do mất khách'), findsNothing);
    expect(find.text('Thích nhà gần biển.'), findsOneWidget);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('1 khách'), findsOneWidget);
  });

  testWidgets('môi giới: là mình thì "(bạn)"', (tester) async {
    repository.onDetail = (id) async =>
        customerDetail(id, agentId: testUser.id);
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(valueOf(tester, 'Môi giới'), 'Nguyễn Văn An (bạn)');
    expect(repository.userNameCalls, isEmpty);
  });

  testWidgets('môi giới khác: có user.view thì hiện tên, không thì "—"', (
    tester,
  ) async {
    repository.onDetail = (id) async => customerDetail(id, agentId: 'u9');
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(valueOf(tester, 'Môi giới'), '—');
    expect(repository.userNameCalls, isEmpty);
  });

  testWidgets('môi giới khác, có quyền xem người dùng: hiện tên', (
    tester,
  ) async {
    user = CurrentUser(
      id: testUser.id,
      fullName: testUser.fullName,
      permissions: const {'user.view': 'COMPANY'},
    );
    repository.onDetail = (id) async => customerDetail(id, agentId: 'u9');
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(valueOf(tester, 'Môi giới'), 'Môi giới u9');
  });

  testWidgets('mất khách: có lý do', (tester) async {
    repository.onDetail = (id) async =>
        customerDetail(id, status: 'LOST', lostReason: 'Mua chỗ khác');
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(find.text('Mất khách'), findsOneWidget);
    expect(valueOf(tester, 'Lý do mất khách'), 'Mua chỗ khác');
  });

  testWidgets('nhu cầu: tóm tắt, tên tỉnh, tạm dừng; trống thì báo', (
    tester,
  ) async {
    repository.onPreferences = (id) async => const [
      CustomerPreference(
        id: 'p1',
        transactionType: 'SALE',
        isActive: true,
        propertyTypes: ['APARTMENT'],
        budgetMin: 2000000000,
        budgetMax: 3000000000,
        provinceIds: ['kh'],
      ),
      CustomerPreference(id: 'p2', transactionType: 'RENT', isActive: false),
    ];
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(find.text('Mua · Căn hộ · 2 tỷ – 3 tỷ · Khánh Hòa'), findsOneWidget);
    expect(find.text('Thuê (tạm dừng)'), findsOneWidget);
  });

  testWidgets('chưa có nhu cầu, chưa có hoạt động', (tester) async {
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(find.text('Chưa nhập nhu cầu.'), findsOneWidget);
    expect(find.text('Chưa có hoạt động nào.'), findsOneWidget);
  });

  testWidgets(
    'timeline: giờ Việt Nam, loại, người ghi; "Xem thêm" tải trang sau',
    (tester) async {
      repository.onActivities = (page) async => activityPage(page, total: 25);
      await open(tester, location: AppRoutes.customerDetail('c1'));
      expect(
        find.text('08:30 08/10/2026 · Gọi điện · Nguyễn Văn An'),
        findsNWidgets(20),
      );
      expect(find.text('Hoạt động số 1'), findsOneWidget);
      expect(find.text('Hoạt động số 21'), findsNothing);

      await tester.ensureVisible(find.text('Xem thêm'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Xem thêm'));
      await tester.pumpAndSettle();
      expect(repository.activityPages, [1, 2]);
      await tester.ensureVisible(find.text('Hoạt động số 25'));
      expect(find.text('Xem thêm'), findsNothing);
    },
  );

  testWidgets('đổi bước trên timeline: hiện bước trước → sau', (tester) async {
    repository.onActivities = (page) async => api.Page(
      items: [
        CustomerActivity(
          id: 'a1',
          type: 'STATUS_CHANGE',
          occurredAt: DateTime.utc(2026, 10, 9, 2),
          fromStatus: 'NEW',
          toStatus: 'LOST',
          content: 'Mua chỗ khác',
          userName: 'Nguyễn Văn An',
        ),
      ],
      meta: const PageMeta(page: 1, pageSize: 20, total: 1, totalPages: 1),
    );
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(
      find.text('09:00 09/10/2026 · Đổi bước · Nguyễn Văn An'),
      findsOneWidget,
    );
    expect(find.text('Mới → Mất khách'), findsOneWidget);
    expect(find.text('Mua chỗ khác'), findsOneWidget);
  });

  testWidgets('lỗi nhu cầu, timeline: thông tin vẫn hiện, thử lại riêng', (
    tester,
  ) async {
    var fail = true;
    repository
      ..onPreferences = ((id) async => fail ? throw _offline : const [])
      ..onActivities = (page) async =>
          fail ? throw _offline : activityPage(page, total: 1);
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(valueOf(tester, 'Mục đích'), 'Đầu tư');
    expect(find.text('Không kết nối được máy chủ'), findsNWidgets(2));

    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Chưa nhập nhu cầu.'), findsOneWidget);
    expect(find.text('Hoạt động số 1'), findsOneWidget);
  });

  testWidgets('không tìm thấy hoặc không được xem: báo rõ', (tester) async {
    repository.onDetail = (id) async => throw const ApiException(
      code: ErrorCodes.notFound,
      message: 'Không tìm thấy',
      statusCode: 404,
    );
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(
      find.text('Không tìm thấy khách, hoặc bạn không có quyền xem khách này.'),
      findsOneWidget,
    );
  });

  testWidgets('kéo xuống tải lại; lỗi thì giữ dữ liệu cũ và báo snackbar', (
    tester,
  ) async {
    var calls = 0;
    repository.onDetail = (id) async {
      calls++;
      if (calls == 3) {
        throw _offline;
      }
      return customerDetail(id, notes: 'Lần $calls');
    };
    await open(tester, location: AppRoutes.customerDetail('c1'));
    expect(find.text('Lần 1'), findsOneWidget);
    await tester.fling(find.text('Thông tin'), const Offset(0, 1500), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Lần 2'), findsOneWidget);
    await tester.fling(find.text('Thông tin'), const Offset(0, 1500), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Lần 2'), findsOneWidget);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    repository
      ..onDetail = ((id) async => customerDetail(
        id,
        status: 'LOST',
        lostReason: 'Khách đổi ý, mua căn khác ở quận khác gần trường học',
      ))
      ..onActivities = (page) async => activityPage(page, total: 25);
    await open(
      tester,
      location: AppRoutes.customerDetail('c1'),
      size: const Size(960, 2000),
    );
    expect(find.text('Thông tin'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
