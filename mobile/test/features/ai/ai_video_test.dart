import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/domain/ai_video.dart';
import 'package:real_estate_os/features/ai/presentation/ai_providers.dart';
import 'package:real_estate_os/features/properties/presentation/property_detail_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_ai.dart';
import '../../support/fake_properties.dart';

void main() {
  late FakeAiRepository ai;

  setUp(() => ai = FakeAiRepository());

  Future<void> open(
    WidgetTester tester, {
    Size size = const Size(1200, 2400),
  }) async {
    tester.view.physicalSize = size;
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

  IconData? pausedIcon(WidgetTester tester) =>
      tester.widget<Icon>(find.byKey(const Key('ai-video-paused'))).icon;

  test('cảnh đang phát theo thời gian, bỏ cảnh 0 giây', () {
    final video = AiVideo.fromJson(const {
      'property': {'code': 'BDS-000001'},
      'scenes': [
        {'kind': 'INTRO', 'imageUrl': 'a', 'durationSeconds': 4, 'title': 'A'},
        {'kind': 'CTA', 'imageUrl': 'b', 'durationSeconds': 0, 'title': 'Bỏ'},
        {
          'kind': 'FACTS',
          'imageUrl': 'c',
          'durationSeconds': 6,
          'title': 'B',
          'lines': ['Giá 5 tỷ', 1],
        },
      ],
    });
    expect(video.scenes.map((scene) => scene.title), ['A', 'B']);
    expect(video.scenes.last.lines, ['Giá 5 tỷ']);
    expect(video.duration, const Duration(seconds: 10));
    expect(video.sceneAt(Duration.zero), (0, 0.0));
    expect(video.sceneAt(const Duration(seconds: 2)), (0, 0.5));
    expect(video.sceneAt(const Duration(seconds: 7)), (1, 0.5));
    expect(video.sceneAt(const Duration(seconds: 10)), (1, 1.0));
  });

  testWidgets('AI tắt thì không có nút "AI làm video"', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    await open(tester);
    expect(find.text('AI làm video'), findsNothing);
  });

  testWidgets(
    'chọn 15 giây, tạo video, phát từng cảnh, chạm để dừng, hết video thì phát lại',
    (tester) async {
      await open(tester);
      await tester.tap(find.text('AI làm video'));
      await tester.pumpAndSettle();
      expect(find.text('Còn 99 lượt AI trong 24 giờ.'), findsOneWidget);
      await tester.tap(find.text('15 giây'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Tạo video'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(ai.videos, [('p1', 15)]);

      expect(find.text('Video BDS-000001'), findsOneWidget);
      expect(find.text('Nhà phố Vĩnh Hải mới xây'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNWidgets(3));

      await tester.pump(const Duration(seconds: 5));
      expect(find.text('Thông tin'), findsOneWidget);
      expect(find.text('Giá 5 tỷ'), findsOneWidget);
      expect(find.text('Vĩnh Hải, Khánh Hòa'), findsOneWidget);

      await tester.tap(find.byType(AspectRatio));
      await tester.pump();
      expect(pausedIcon(tester), Icons.play_arrow);
      await tester.pump(const Duration(seconds: 10));
      expect(find.text('Thông tin'), findsOneWidget);

      await tester.tap(find.byType(AspectRatio));
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));
      expect(find.text('Nhắn tin để đi xem nhà'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
      expect(pausedIcon(tester), Icons.replay);

      await tester.tap(find.byType(AspectRatio));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Nhà phố Vĩnh Hải mới xây'), findsOneWidget);
      expect(find.byKey(const Key('ai-video-paused')), findsNothing);

      await tester.tap(find.byType(CloseButton));
      await tester.pumpAndSettle();
      expect(find.text('Xem video'), findsOneWidget);
      expect(find.text('Tạo lại'), findsOneWidget);
    },
  );

  testWidgets('BĐS chưa có ảnh: hiện lý do', (tester) async {
    ai.onVideo = (id, seconds) async => throw const ApiException(
      code: ErrorCodes.businessRuleViolation,
      message: 'BĐS chưa có ảnh, hãy thêm ảnh trước khi tạo video',
    );
    await open(tester);
    await tester.tap(find.text('AI làm video'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tạo video'));
    await tester.pumpAndSettle();
    expect(ai.videos, [('p1', 30)]);
    expect(
      find.text('BĐS chưa có ảnh, hãy thêm ảnh trước khi tạo video'),
      findsOneWidget,
    );
    expect(find.text('Video BDS-000001'), findsNothing);
  });

  testWidgets('màn hình hẹp, chữ to: nút và video không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, size: const Size(960, 1704)); // 320 x 568.
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('AI làm video'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI làm video'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Tạo video'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tạo video'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(seconds: 5));
    expect(find.text('Giá 5 tỷ'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(seconds: 10));
  });
}
