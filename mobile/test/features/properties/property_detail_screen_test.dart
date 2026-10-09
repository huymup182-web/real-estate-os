import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/properties/domain/property_detail.dart';
import 'package:real_estate_os/features/properties/presentation/property_detail_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_properties.dart';

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được máy chủ',
);

const _images = [
  PropertyImage(id: 'i1', url: 'https://cdn.test/1.jpg', isCover: true),
  PropertyImage(id: 'i2', url: 'https://cdn.test/2.jpg'),
  PropertyImage(id: 'i3', url: 'https://cdn.test/3.jpg'),
];

void main() {
  late FakePropertiesRepository repository;

  setUp(() => repository = FakePropertiesRepository());

  Future<void> open(
    WidgetTester tester, {
    Size size = const Size(1200, 6000),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [propertiesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const PropertyDetailScreen(propertyId: 'p1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('hiện giá, địa chỉ, thông số, mô tả, chủ nhà, xác minh', (
    tester,
  ) async {
    await open(tester);

    expect(repository.detailCalls, ['p1']);
    expect(find.widgetWithText(AppBar, 'BDS-000001'), findsOneWidget);
    expect(find.text('Đang bán'), findsOneWidget);
    expect(find.text('3,5 tỷ'), findsOneWidget);
    expect(find.text('3.500.000.000 đ · 49,6 triệu/m²'), findsOneWidget);
    expect(find.text('Nhà phố 2 tầng gần biển'), findsOneWidget);
    expect(find.text('12 Đường 2/4, Vĩnh Hải, Khánh Hòa'), findsOneWidget);
    for (final (label, value) in [
      ('Loại', 'Nhà phố, nhà riêng'),
      ('Diện tích', '70,5 m²'),
      ('Phòng ngủ', '3'),
      ('WC', '2'),
      ('Số tầng', '2'),
      ('Hướng', 'Đông Nam'),
      ('Đường trước nhà', '6 m'),
      ('Đường vào', 'Ô tô vào được'),
      ('Pháp lý', 'Sổ riêng'),
      ('Họ tên', 'Chủ nhà A'),
      ('Điện thoại', '+84901234567'),
      ('Email', 'chu@a.vn'),
      ('Tình trạng', 'Đã xác minh'),
      ('Xác minh lần cuối', '01/10/2026'),
      ('Cập nhật', '09:30 08/10/2026'),
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
      expect(find.text(value), findsWidgets, reason: label);
    }
    expect(find.text('Nhà mới xây, hẻm ô tô.'), findsOneWidget);
  });

  testWidgets('không được xem liên hệ: không có số nhà, báo ở phần chủ nhà', (
    tester,
  ) async {
    repository.onDetail = (id) async =>
        propertyDetail(id, ownerContactVisible: false);
    await open(tester);
    expect(find.text('Vĩnh Hải, Khánh Hòa'), findsOneWidget);
    expect(
      find.text(
        'Bạn không được xem liên hệ chủ nhà và địa chỉ chi tiết của BĐS này.',
      ),
      findsOneWidget,
    );
    expect(find.text('Điện thoại'), findsNothing);
  });

  testWidgets('được xem nhưng chưa có chủ nhà', (tester) async {
    repository.onDetail = (id) async => propertyDetail(id, owner: null);
    await open(tester);
    expect(find.text('Chưa có thông tin chủ nhà.'), findsOneWidget);
  });

  testWidgets('BĐS không tồn tại hoặc không được xem: báo rõ', (tester) async {
    repository.onDetail = (id) async => throw const ApiException(
      code: ErrorCodes.notFound,
      message: 'Không tìm thấy BĐS',
      statusCode: 404,
    );
    await open(tester);
    expect(
      find.text('Không tìm thấy BĐS, hoặc bạn không có quyền xem BĐS này.'),
      findsOneWidget,
    );
    expect(find.text('Thử lại'), findsNothing);
  });

  testWidgets('lỗi mạng: thử lại được', (tester) async {
    var fail = true;
    repository.onDetail = (id) async =>
        fail ? throw _offline : propertyDetail(id);
    await open(tester);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('3,5 tỷ'), findsOneWidget);
  });

  testWidgets('ảnh: vuốt đổi số thứ tự, chạm mở xem lớn', (tester) async {
    repository.onImages = (id) async => _images;
    await open(tester);
    expect(find.text('1/3'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(-500, 0));
    await tester.pumpAndSettle();
    expect(find.text('2/3'), findsOneWidget);

    await tester.tap(find.byType(PageView));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, '2/3'), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsWidgets);
  });

  testWidgets('chưa có ảnh: ảnh giữ chỗ; lỗi tải ảnh: thử lại riêng', (
    tester,
  ) async {
    var fail = true;
    repository.onImages = (id) async => fail ? throw _offline : _images;
    await open(tester);
    expect(find.text('Không tải được ảnh'), findsOneWidget);
    expect(find.text('3,5 tỷ'), findsOneWidget);

    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('1/3'), findsOneWidget);
  });

  testWidgets('kéo xuống tải lại; lỗi thì giữ dữ liệu cũ và báo snackbar', (
    tester,
  ) async {
    await open(tester);
    repository.onDetail = (id) async => throw _offline;
    await tester.fling(find.text('3,5 tỷ'), const Offset(0, 1200), 1000);
    await tester.pumpAndSettle();
    expect(repository.detailCalls, ['p1', 'p1']);
    expect(find.text('3,5 tỷ'), findsOneWidget);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    repository.onImages = (id) async => _images;
    await open(tester, size: const Size(960, 6000));
    expect(find.text('3,5 tỷ'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('chạm thẻ trong danh sách mở chi tiết, quay lại về danh sách', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    repository.onList = (page) async => pageOf([property(7)], total: 1);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => testUser),
          ),
          propertiesRepositoryProvider.overrideWithValue(repository),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('BĐS'),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Nhà phố số 7'));
    await tester.pumpAndSettle();
    expect(repository.detailCalls, ['p7']);
    expect(find.text('Nhà phố 2 tầng gần biển'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố số 7'), findsOneWidget);
  });
}
