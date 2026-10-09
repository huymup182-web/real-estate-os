import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';
import 'package:real_estate_os/features/properties/domain/property_query.dart';
import 'package:real_estate_os/features/properties/presentation/properties_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_locations.dart';
import '../../support/fake_properties.dart';

void main() {
  late FakePropertiesRepository repository;
  late FakeLocationsRepository locations;

  PropertyQuery lastQuery() => repository.listedQueries.last;

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    locations = FakeLocationsRepository();
    // Không lọc gì: 3 BĐS; có lọc: chỉ BĐS 1.
    repository = FakePropertiesRepository((page) async {
      final items = lastQuery().hasFilters
          ? [property(1)]
          : [property(1), property(2), property(3)];
      return pageOf(items, total: items.length);
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          propertiesRepositoryProvider.overrideWithValue(repository),
          locationsRepositoryProvider.overrideWithValue(locations),
        ],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const PropertiesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byTooltip('Bộ lọc'));
    await tester.pumpAndSettle();
  }

  Finder field(String section, String label) => find.descendant(
    of: find
        .ancestor(of: find.text(section), matching: find.byType(Column))
        .first,
    matching: find.widgetWithText(TextFormField, label),
  );

  /// Cuộn bảng lọc cho [target] hiện ra (màn thấp thì phần dưới khuất).
  Future<void> reveal(WidgetTester tester, Finder target) async {
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
  }

  Future<void> tapChip(WidgetTester tester, String label) async {
    final chip = find.widgetWithText(FilterChip, label);
    await reveal(tester, chip);
    await tester.tap(chip);
    await tester.pump();
  }

  Future<void> choose(WidgetTester tester, String dropdown, String item) async {
    final field = find.widgetWithText(
      DropdownButtonFormField<String?>,
      dropdown,
    );
    await reveal(tester, field);
    await tester.tap(field);
    await tester.pumpAndSettle();
    await tester.tap(find.text(item).last);
    await tester.pumpAndSettle();
  }

  testWidgets('chọn lọc rồi áp dụng: gọi lại trang đầu với đủ tham số', (
    tester,
  ) async {
    await open(tester);
    expect(find.text('3 BĐS'), findsOneWidget);
    await openSheet(tester);

    await tapChip(tester, 'Giá tăng dần');
    await tapChip(tester, 'Căn hộ');
    await tapChip(tester, 'Biệt thự');
    await tester.enterText(field('Giá (tỷ đồng)', 'Từ'), '2,5');
    await tester.enterText(field('Giá (tỷ đồng)', 'Đến'), '6');
    await tester.enterText(field('Diện tích (m²)', 'Đến'), '120.5');
    await choose(tester, 'Mọi tỉnh/thành', 'Khánh Hòa');
    await choose(tester, 'Mọi phường/xã', 'Vĩnh Hải');
    await tapChip(tester, '3+');
    await tapChip(tester, 'Sổ riêng');
    await tapChip(tester, 'Đông Nam');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();

    expect(
      lastQuery(),
      const PropertyQuery(
        sort: 'price_asc',
        propertyTypes: {'APARTMENT', 'VILLA'},
        priceMin: 2500000000,
        priceMax: 6000000000,
        areaMax: 120.5,
        provinceId: 'kh',
        wardId: 'kh-vh',
        bedroomsMin: 3,
        legalStatuses: {'PRIVATE_BOOK'},
        directions: {'SE'},
      ),
    );
    expect(repository.listedPages.last, 1);
    expect(find.text('1 kết quả'), findsOneWidget);
    // Badge: sắp xếp, loại, giá, diện tích, khu vực, phòng ngủ, pháp lý, hướng.
    expect(find.text('8'), findsOneWidget);

    // Mở lại thấy giá trị đang dùng.
    await openSheet(tester);
    expect(find.text('2,5'), findsOneWidget);
    expect(find.text('120,5'), findsOneWidget);
    expect(find.text('Vĩnh Hải'), findsOneWidget);
    expect(
      tester
          .widget<FilterChip>(find.widgetWithText(FilterChip, 'Căn hộ'))
          .selected,
      isTrue,
    );
  });

  testWidgets('giá đến nhỏ hơn giá từ: báo lỗi, không đóng, không gọi API', (
    tester,
  ) async {
    await open(tester);
    await openSheet(tester);
    final calls = repository.listedQueries.length;

    await tester.enterText(field('Giá (tỷ đồng)', 'Từ'), '6');
    await tester.enterText(field('Giá (tỷ đồng)', 'Đến'), '2');
    await tester.enterText(field('Diện tích (m²)', 'Từ'), '1,234');
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();

    expect(find.text('Giá đến phải từ giá từ trở lên'), findsOneWidget);
    expect(find.text('Nhập số, tối đa 2 chữ số sau dấu phẩy'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Áp dụng'), findsOneWidget);
    expect(repository.listedQueries, hasLength(calls));
  });

  testWidgets('đổi tỉnh thì bỏ phường đã chọn', (tester) async {
    await open(tester);
    await openSheet(tester);
    await choose(tester, 'Mọi tỉnh/thành', 'Khánh Hòa');
    await choose(tester, 'Mọi phường/xã', 'Vĩnh Hải');
    await choose(tester, 'Khánh Hòa', 'Lâm Đồng');
    expect(find.text('Vĩnh Hải'), findsNothing);
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();
    expect(lastQuery().provinceId, 'ld');
    expect(lastQuery().wardId, isNull);
    expect(locations.wardCalls, ['kh', 'ld']);
  });

  testWidgets('"Xoá lọc" trong bảng đưa về mặc định, giữ từ khoá', (
    tester,
  ) async {
    await open(tester);
    await tester.enterText(find.byType(TextField).first, 'abc');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    await openSheet(tester);
    await tapChip(tester, 'Căn hộ');
    await tester.enterText(field('Giá (tỷ đồng)', 'Từ'), '9');
    await tester.enterText(field('Giá (tỷ đồng)', 'Đến'), '1');
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();
    expect(find.text('Giá đến phải từ giá từ trở lên'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Xoá lọc'));
    await tester.pumpAndSettle();
    expect(find.text('Giá đến phải từ giá từ trở lên'), findsNothing);
    expect(find.text('9'), findsNothing);
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();
    expect(lastQuery(), const PropertyQuery(keyword: 'abc'));
  });

  testWidgets('lọc không ra BĐS nào: báo và có nút xoá bộ lọc', (tester) async {
    await open(tester);
    repository.onList = (page) async => lastQuery().hasFilters
        ? pageOf(const [], total: 0)
        : pageOf([property(1)], total: 1);
    await openSheet(tester);
    await tapChip(tester, 'Kho, xưởng');
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();
    expect(find.text('Không có BĐS nào khớp bộ lọc.'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Xoá bộ lọc'));
    await tester.pumpAndSettle();
    expect(lastQuery(), const PropertyQuery());
    expect(find.text('1 BĐS'), findsOneWidget);
  });

  testWidgets('đóng bảng không áp dụng thì không gọi lại', (tester) async {
    await open(tester);
    await openSheet(tester);
    await tapChip(tester, 'Căn hộ');
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    expect(repository.listedQueries, hasLength(1));
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: nút lọc và bảng lọc không tràn', (
    tester,
  ) async {
    await open(tester);
    tester.view.physicalSize = const Size(960, 2000);
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpAndSettle();
    await openSheet(tester);
    await tester.enterText(field('Giá (tỷ đồng)', 'Từ'), '1');
    await tester.enterText(field('Giá (tỷ đồng)', 'Đến'), '0');
    await choose(tester, 'Mọi tỉnh/thành', 'Lâm Đồng');
    await choose(tester, 'Mọi phường/xã', 'Xuân Hương - Đà Lạt');
    await tapChip(tester, 'Tây Nam');
    // Ô giá đã khuất phía trên: bấm áp dụng thì cuộn lên chỗ lỗi.
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();
    final error = find.text('Giá đến phải từ giá từ trở lên');
    expect(error, findsOneWidget);
    expect(tester.getRect(error).top, greaterThan(0));
    expect(
      tester.getRect(error).bottom,
      lessThan(tester.getRect(find.text('Áp dụng')).top),
    );
    expect(tester.takeException(), isNull);
  });
}
