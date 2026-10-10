import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/presentation/ai_providers.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';
import 'package:real_estate_os/features/properties/domain/property_query.dart';
import 'package:real_estate_os/features/properties/presentation/properties_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_ai.dart';
import '../../support/fake_locations.dart';
import '../../support/fake_properties.dart';

const _result = {
  'filters': {
    'q': 'view biển',
    'provinceId': 'kh',
    'priceMin': 4500000000,
    'priceMax': 5500000000,
    'propertyType': ['HOUSE'],
    'bedroomsMin': 3,
    'roadAccess': ['CAR'],
  },
  'explanation':
      'Nhà ở Nha Trang, giá khoảng 5 tỷ, từ 3 phòng ngủ, ô tô vào được.',
  'unresolved': ['Nha Trang'],
};

void main() {
  late FakePropertiesRepository properties;
  late FakeAiRepository ai;

  PropertyQuery lastQuery() => properties.listedQueries.last;

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    properties = FakePropertiesRepository(
      (page) async => pageOf([property(1)], total: 1),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          propertiesRepositoryProvider.overrideWithValue(properties),
          aiRepositoryProvider.overrideWithValue(ai),
          locationsRepositoryProvider.overrideWithValue(
            FakeLocationsRepository(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const PropertiesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> askAi(WidgetTester tester, String text) async {
    await tester.tap(find.byTooltip('Tìm bằng AI'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('ai-search-input')), text);
    await tester.tap(find.widgetWithText(FilledButton, 'Tìm'));
    await tester.pumpAndSettle();
  }

  setUp(() {
    ai = FakeAiRepository(
      onSearch: (_) async => AiPropertySearch.fromJson(_result),
    );
  });

  testWidgets('AI tắt thì không có nút "Tìm bằng AI"', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    await open(tester);
    expect(find.byTooltip('Tìm bằng AI'), findsNothing);
    expect(find.byTooltip('Bộ lọc'), findsOneWidget);
  });

  testWidgets(
    'gõ câu tự nhiên: AI đổi thành bộ lọc, danh sách tìm lại, hiện giải thích',
    (tester) async {
      await open(tester);
      await tester.tap(find.byTooltip('Tìm bằng AI'));
      await tester.pumpAndSettle();
      expect(find.text('Còn 99 lượt AI trong 24 giờ.'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('ai-search-input')),
        '  nhà khoảng 5 tỷ   ở Nha Trang ',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Tìm'));
      await tester.pumpAndSettle();

      expect(ai.searches, ['nhà khoảng 5 tỷ ở Nha Trang']);
      expect(
        lastQuery(),
        const PropertyQuery(
          keyword: 'view biển',
          provinceId: 'kh',
          priceMin: 4500000000,
          priceMax: 5500000000,
          propertyTypes: {'HOUSE'},
          bedroomsMin: 3,
          roadAccesses: {'CAR'},
        ),
      );
      expect(properties.listedPages.last, 1);
      // Ô tìm hiện từ khoá AI rút ra, nút lọc đếm 5 nhóm (loại, giá, khu vực, phòng ngủ, đường vào).
      expect(find.widgetWithText(TextField, 'view biển'), findsOneWidget);
      expect(find.text('5'), findsOneWidget);
      expect(find.text(_result['explanation']! as String), findsOneWidget);
      expect(
        find.textContaining('Chưa lọc theo khu vực: Nha Trang'),
        findsOneWidget,
      );
      // Lượt AI đã dùng: tải lại số lượt còn lại.
      expect(ai.statusCalls, 2);

      await tester.tap(find.byTooltip('Ẩn giải thích của AI'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('ai-search-banner')), findsNothing);
    },
  );

  testWidgets('đổi bộ lọc sau khi tìm bằng AI thì ẩn giải thích', (
    tester,
  ) async {
    await open(tester);
    await askAi(tester, 'nhà 5 tỷ');
    expect(find.byKey(const Key('ai-search-banner')), findsOneWidget);

    await tester.tap(find.byTooltip('Bộ lọc'));
    await tester.pumpAndSettle();
    final chip = find.widgetWithText(FilterChip, 'Căn hộ');
    await tester.ensureVisible(chip);
    await tester.tap(chip);
    await tester.tap(find.widgetWithText(FilledButton, 'Áp dụng'));
    await tester.pumpAndSettle();

    expect(lastQuery().propertyTypes, {'HOUSE', 'APARTMENT'});
    expect(find.byKey(const Key('ai-search-banner')), findsNothing);
  });

  testWidgets('AI lỗi hoặc hết lượt: báo trong bảng, không đổi danh sách', (
    tester,
  ) async {
    ai.onSearch = (_) async => throw const ApiException(
      code: ErrorCodes.rateLimited,
      message: 'Bạn đã dùng hết 100 lượt AI trong 24 giờ, vui lòng thử lại sau',
      statusCode: 429,
    );
    await open(tester);
    final before = properties.listedQueries.length;
    await askAi(tester, 'nhà 5 tỷ');

    expect(
      find.text(
        'Bạn đã dùng hết 100 lượt AI trong 24 giờ, vui lòng thử lại sau',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const Key('ai-search-input')), findsOneWidget);
    expect(properties.listedQueries, hasLength(before));
  });

  testWidgets('câu quá ngắn thì nhắc, không gọi AI', (tester) async {
    await open(tester);
    await askAi(tester, ' a ');
    expect(ai.searches, isEmpty);
    expect(find.textContaining('Nhập điều kiện cần tìm'), findsOneWidget);
  });

  testWidgets('hết lượt AI thì nút "Tìm" bị tắt', (tester) async {
    ai.currentStatus = const AiStatus(
      enabled: true,
      dailyLimit: 100,
      remaining: 0,
    );
    await open(tester);
    await tester.tap(find.byTooltip('Tìm bằng AI'));
    await tester.pumpAndSettle();
    expect(find.text('Còn 0 lượt AI trong 24 giờ.'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Tìm'))
          .onPressed,
      isNull,
    );
  });

  test('PropertyQuery.fromFilters bỏ trường lạ, sai kiểu; phường cần tỉnh', () {
    expect(
      PropertyQuery.fromFilters(const {
        'propertyType': ['APARTMENT', 'CASTLE', 5],
        'priceMin': 2.5,
        'priceMax': 3000000000.0,
        'areaMin': 60,
        'wardId': 'kh-vh',
        'legalStatus': ['PRIVATE_BOOK'],
        'direction': 'SE',
        'sort': 'cheapest',
        'unknown': true,
      }),
      const PropertyQuery(
        propertyTypes: {'APARTMENT'},
        priceMax: 3000000000,
        areaMin: 60,
        legalStatuses: {'PRIVATE_BOOK'},
      ),
    );
    expect(
      PropertyQuery.fromFilters(const {
        'provinceId': 'kh',
        'wardId': 'kh-vh',
        'sort': 'price_asc',
      }),
      const PropertyQuery(provinceId: 'kh', wardId: 'kh-vh', sort: 'price_asc'),
    );
  });
}
