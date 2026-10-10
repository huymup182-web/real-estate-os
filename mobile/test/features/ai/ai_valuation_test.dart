import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/domain/ai_valuation.dart';
import 'package:real_estate_os/features/ai/presentation/ai_providers.dart';
import 'package:real_estate_os/features/ai/presentation/ai_valuation_sheet.dart';
import 'package:real_estate_os/features/properties/presentation/property_detail_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_ai.dart';
import '../../support/fake_properties.dart';

void main() {
  late FakeAiRepository ai;

  setUp(() => ai = FakeAiRepository());

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 4000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          propertiesRepositoryProvider.overrideWithValue(
            FakePropertiesRepository(),
          ),
          aiRepositoryProvider.overrideWithValue(ai),
        ],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const PropertyDetailScreen(propertyId: 'p1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  test('đọc kết quả định giá, mức tin cậy lạ thì Thấp', () {
    final result = AiValuation.fromJson(const {
      'estimate': {'price': 5060000000, 'pricePerM2': 63250000},
      'range': {'low': 4730000000, 'high': 5500000000},
      'base': {'price': 4600000000, 'pricePerM2': 57500000},
      'adjustmentPercent': -2.5,
      'maxAdjustmentPercent': 10,
      'confidence': 'VERY_HIGH',
      'summary': 'Theo giá khu vực.',
      'askingPrice': 5000000000,
      'askingVsEstimatePercent': null,
    });
    expect(result.estimatePrice, 5060000000);
    expect(result.adjustmentPercent, -2.5);
    expect(result.confidence, AiValuationConfidence.low);
    expect(result.factors, isEmpty);
    expect(result.comparables, isEmpty);
    expect(signedPercent(result.adjustmentPercent), '-2,5%');
    expect(signedPercent(10), '+10%');
    expect(signedPercent(0), '0%');
    expect(askingComparison(result), 'Giá chào bán 5 tỷ, bằng giá ước tính.');
  });

  testWidgets('AI tắt thì không có nút "AI định giá"', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    await open(tester);
    expect(find.text('AI định giá'), findsNothing);
  });

  testWidgets(
    '"AI định giá" gọi AI một lần, hiện giá ước tính, khoảng giá, yếu tố, BĐS tương tự',
    (tester) async {
      await open(tester);
      expect(ai.valuations, isEmpty);
      await tester.tap(find.text('AI định giá'));
      await tester.pumpAndSettle();
      expect(ai.valuations, ['p1']);

      expect(find.text('5,1 tỷ'), findsOneWidget);
      expect(
        find.text('Khoảng 4,7 tỷ – 5,5 tỷ · 63,3 triệu/m²'),
        findsOneWidget,
      );
      expect(find.text('Độ tin cậy: Trung bình'), findsOneWidget);
      expect(
        find.text('Giá chào bán 5 tỷ, thấp hơn ước tính 1,2%.'),
        findsOneWidget,
      );
      expect(
        find.text('Pháp lý: Sổ riêng, tốt hơn căn sổ chung.'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.arrow_upward), findsOneWidget);
      expect(find.text('BĐS tương tự (2)'), findsOneWidget);
      expect(
        find.text(
          'BDS-000002 · 4 tỷ · 80 m² · 50 triệu/m² · Đã bán · Cùng phường',
        ),
        findsOneWidget,
      );
      expect(
        find.text(
          'BDS-000003 · 6,3 tỷ · 90 m² · 70 triệu/m² · Đang bán · Gần đó',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('AI chỉnh +10% (tối đa ±10%)'),
        findsOneWidget,
      );
    },
  );

  testWidgets('chưa đủ BĐS tương tự: hiện lý do, không có nút thử lại', (
    tester,
  ) async {
    ai.onValuation = (id) async => throw const ApiException(
      code: ErrorCodes.businessRuleViolation,
      message: 'Chưa đủ BĐS tương tự để định giá (cần ít nhất 3, có 1)',
    );
    await open(tester);
    await tester.tap(find.text('AI định giá'));
    await tester.pumpAndSettle();
    expect(
      find.text('Chưa đủ BĐS tương tự để định giá (cần ít nhất 3, có 1)'),
      findsOneWidget,
    );
    expect(find.text('Thử lại'), findsNothing);
  });
}
