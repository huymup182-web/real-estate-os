import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_locations.dart';
import '../../support/fake_properties.dart';

void main() {
  late FakePropertiesRepository repository;

  setUp(() => repository = FakePropertiesRepository());

  Finder field(String label) => find.widgetWithText(TextFormField, label);

  /// Mở app, vào thẳng chi tiết BĐS p1.
  Future<void> openDetail(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 7200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => testUser),
          ),
          propertiesRepositoryProvider.overrideWithValue(repository),
          locationsRepositoryProvider.overrideWithValue(
            FakeLocationsRepository(),
          ),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    final context = tester.element(find.byType(NavigationBar));
    GoRouter.of(context).go(AppRoutes.propertyDetail('p1'));
    await tester.pumpAndSettle();
  }

  Future<void> openEdit(WidgetTester tester) async {
    await openDetail(tester);
    await tester.tap(find.byTooltip('Sửa BĐS'));
    await tester.pumpAndSettle();
  }

  Future<void> save(WidgetTester tester) async {
    final button = find.widgetWithText(FilledButton, 'Lưu thay đổi');
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  testWidgets('không sửa được BĐS thì không có nút sửa', (tester) async {
    repository.onDetail = (id) async => propertyDetail(id, canEdit: false);
    await openDetail(tester);
    expect(find.text('Nhà phố 2 tầng gần biển'), findsOneWidget);
    expect(find.byTooltip('Sửa BĐS'), findsNothing);
  });

  testWidgets('form điền sẵn giá trị hiện tại', (tester) async {
    await openEdit(tester);
    expect(find.widgetWithText(AppBar, 'Sửa BĐS'), findsOneWidget);
    expect(find.text('Nhà phố 2 tầng gần biển'), findsOneWidget);
    expect(find.text('Nhà phố, nhà riêng'), findsOneWidget);
    expect(find.text('3.500.000.000'), findsOneWidget);
    expect(find.text('70,5'), findsOneWidget);
    expect(find.text('Khánh Hòa'), findsOneWidget);
    expect(find.text('Vĩnh Hải'), findsOneWidget);
    expect(find.text('12 Đường 2/4'), findsOneWidget);
    expect(find.text('Đông Nam'), findsOneWidget);
    expect(find.text('Ô tô vào được'), findsOneWidget);
    expect(find.text('Sổ riêng'), findsOneWidget);
    expect(find.text('Nhà mới xây, hẻm ô tô.'), findsOneWidget);
  });

  testWidgets(
    'lưu: gửi đủ trường, ô xoá thành null, kèm expectedUpdatedAt; quay về chi tiết đã tải lại',
    (tester) async {
      await openEdit(tester);
      await tester.enterText(field('Tiêu đề *'), 'Nhà phố đã sửa');
      await tester.enterText(field('Phòng ngủ'), '');
      await save(tester);

      final [(:id, :body)] = repository.updated;
      expect(id, 'p1');
      expect(body, {
        'title': 'Nhà phố đã sửa',
        'description': 'Nhà mới xây, hẻm ô tô.',
        'propertyType': 'HOUSE',
        'price': 3500000000,
        'area': 70.5,
        'bedrooms': null,
        'bathrooms': 2,
        'floors': 2,
        'direction': 'SE',
        'roadWidth': 6.0,
        'roadAccess': 'CAR',
        'legalStatus': 'PRIVATE_BOOK',
        'provinceId': 'kh',
        'wardId': 'kh-vh',
        'streetAddress': '12 Đường 2/4',
        'expectedUpdatedAt': '2026-10-08T02:30:00.000Z',
      });
      expect(find.text('Đã lưu thay đổi.'), findsOneWidget);
      expect(find.widgetWithText(AppBar, 'BDS-000001'), findsOneWidget);
      expect(repository.detailCalls.length, greaterThanOrEqualTo(2));
    },
  );

  testWidgets('không xem được địa chỉ chi tiết: không có ô, không gửi', (
    tester,
  ) async {
    repository.onDetail = (id) async =>
        propertyDetail(id, ownerContactVisible: false);
    await openEdit(tester);
    expect(field('Số nhà, tên đường'), findsNothing);
    await save(tester);
    expect(
      repository.updated.single.body.containsKey('streetAddress'),
      isFalse,
    );
  });

  testWidgets('người khác vừa sửa (409): báo, ở lại form', (tester) async {
    repository.onUpdate = (id, draft) async => throw const ApiException(
      code: ErrorCodes.conflict,
      message: 'Conflict',
      statusCode: 409,
    );
    await openEdit(tester);
    await tester.enterText(field('Tiêu đề *'), 'Sửa trùng');
    await save(tester);
    expect(
      find.text(
        'BĐS vừa được người khác sửa. Quay lại, kéo xuống để tải bản mới rồi sửa lại.',
      ),
      findsOneWidget,
    );
    expect(find.widgetWithText(AppBar, 'Sửa BĐS'), findsOneWidget);
  });
}
