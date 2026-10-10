import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/ai/domain/ai_listing.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/presentation/ai_providers.dart';
import 'package:real_estate_os/features/properties/presentation/property_detail_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_ai.dart';
import '../../support/fake_properties.dart';

void main() {
  late FakeAiRepository ai;
  late List<String> copied;

  setUp(() {
    ai = FakeAiRepository();
    copied = [];
  });

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied.add((call.arguments as Map)['text'] as String);
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
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

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byTooltip('AI viết tin'));
    await tester.pumpAndSettle();
  }

  testWidgets('AI tắt thì không có nút "AI viết tin"', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    await open(tester);
    expect(find.byTooltip('AI viết tin'), findsNothing);
  });

  testWidgets(
    'viết tin kiểu chuyên nghiệp, đổi sang ngắn gọn viết lại, sao chép',
    (tester) async {
      await open(tester);
      await openSheet(tester);
      expect(find.text('Còn 99 lượt AI trong 24 giờ.'), findsOneWidget);
      expect(ai.listings, isEmpty);

      await tester.tap(find.text('Viết tin'));
      await tester.pumpAndSettle();
      expect(ai.listings, [('p1', AiListingStyle.professional)]);
      expect(find.text('Bán nhà phố Vĩnh Hải (Chuyên nghiệp)'), findsOneWidget);
      expect(
        find.text('Nhà mới xây gần chợ.\nGiá 3,5 tỷ, 70,5 m².'),
        findsOneWidget,
      );

      await tester.tap(find.text('Ngắn gọn'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Viết lại'));
      await tester.pumpAndSettle();
      expect(ai.listings.last, ('p1', AiListingStyle.short));
      expect(find.text('Bán nhà phố Vĩnh Hải (Ngắn gọn)'), findsOneWidget);

      await tester.tap(find.byTooltip('Sao chép tiêu đề'));
      await tester.pumpAndSettle();
      expect(find.text('Đã sao chép tiêu đề.'), findsOneWidget);
      await tester.tap(find.text('Sao chép cả tin'));
      await tester.pumpAndSettle();
      expect(copied, [
        'Bán nhà phố Vĩnh Hải (Ngắn gọn)',
        'Bán nhà phố Vĩnh Hải (Ngắn gọn)\n\nNhà mới xây gần chợ.\nGiá 3,5 tỷ, 70,5 m².',
      ]);
    },
  );

  testWidgets(
    'bài Facebook (TASK-137): gửi kiểu FACEBOOK, hiện dòng mở đầu và thân bài',
    (tester) async {
      await open(tester);
      await openSheet(tester);
      await tester.tap(find.text('Facebook'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Viết tin'));
      await tester.pumpAndSettle();
      expect(ai.listings, [('p1', AiListingStyle.facebook)]);
      expect(find.text('Dòng mở đầu'), findsOneWidget);
      expect(find.text('Thân bài'), findsOneWidget);
      expect(find.text('Tiêu đề'), findsNothing);
      await tester.tap(find.byTooltip('Sao chép dòng mở đầu'));
      await tester.pumpAndSettle();
      expect(find.text('Đã sao chép dòng mở đầu.'), findsOneWidget);
      expect(copied, ['Bán nhà phố Vĩnh Hải (Facebook)']);
    },
  );

  testWidgets('AI lỗi thì báo lỗi, vẫn bấm lại được', (tester) async {
    ai.onListing = (propertyId, style) async => throw const ApiException(
      code: ErrorCodes.serviceUnavailable,
      message: 'AI chưa viết được tin đăng, vui lòng thử lại',
    );
    await open(tester);
    await openSheet(tester);
    await tester.tap(find.text('Viết tin'));
    await tester.pumpAndSettle();
    expect(
      find.text('AI chưa viết được tin đăng, vui lòng thử lại'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<ButtonStyleButton>(
            find.ancestor(
              of: find.text('Viết tin'),
              matching: find.bySubtype<ButtonStyleButton>(),
            ),
          )
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('hết lượt AI thì nút "Viết tin" tắt', (tester) async {
    ai.currentStatus = const AiStatus(
      enabled: true,
      dailyLimit: 100,
      remaining: 0,
    );
    await open(tester);
    await openSheet(tester);
    expect(
      tester
          .widget<ButtonStyleButton>(
            find.ancestor(
              of: find.text('Viết tin'),
              matching: find.bySubtype<ButtonStyleButton>(),
            ),
          )
          .onPressed,
      isNull,
    );
  });
}
