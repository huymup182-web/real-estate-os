import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/ai/domain/ai_copilot.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/presentation/ai_providers.dart';
import 'package:real_estate_os/features/ai/presentation/copilot_screen.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/customers/presentation/customer_list_controller.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_ai.dart';
import '../../support/fake_auth.dart';
import '../../support/fake_customers.dart';
import '../../support/fake_locations.dart';
import '../../support/fake_properties.dart';

void main() {
  late FakeAiRepository ai;

  setUp(() => ai = FakeAiRepository());

  Future<GoRouter> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(
              () async => CurrentUser(
                id: testUser.id,
                fullName: testUser.fullName,
                permissions: const {
                  'customer.view': 'OWN',
                  'property.view': 'COMPANY',
                },
              ),
            ),
          ),
          customersRepositoryProvider.overrideWithValue(
            FakeCustomersRepository(),
          ),
          propertiesRepositoryProvider.overrideWithValue(
            FakePropertiesRepository(),
          ),
          aiRepositoryProvider.overrideWithValue(ai),
          locationsRepositoryProvider.overrideWithValue(
            FakeLocationsRepository(),
          ),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    return GoRouter.of(tester.element(find.byType(NavigationBar)));
  }

  String location(GoRouter router) => router.state.uri.toString();

  testWidgets('AI tắt thì không có nút Copilot', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    final router = await open(tester);
    expect(find.byTooltip('Copilot AI'), findsNothing);
    router.go(AppRoutes.customerDetail('c1'));
    await tester.pumpAndSettle();
    expect(find.text('Hỏi Copilot'), findsNothing);
  });

  testWidgets(
    'từ trang chủ: chọn câu gợi ý, hiện câu trả lời, thẻ khách và BĐS; hỏi tiếp gửi cả hội thoại',
    (tester) async {
      final router = await open(tester);
      await tester.tap(find.byTooltip('Copilot AI'));
      await tester.pumpAndSettle();
      expect(location(router), '/home/copilot');
      for (final suggestion in copilotSuggestions.general) {
        expect(find.text(suggestion), findsOneWidget);
      }
      expect(find.textContaining('Còn 99 lượt AI'), findsOneWidget);

      await tester.tap(find.text('Khách nào cần follow-up hôm nay?'));
      await tester.pumpAndSettle();
      expect(ai.copilotCalls, hasLength(1));
      final (history, context) = ai.copilotCalls.single;
      expect(
        [for (final turn in history) turn.toJson()],
        [
          {'role': 'user', 'content': 'Khách nào cần follow-up hôm nay?'},
        ],
      );
      expect(context.toJson(), isEmpty);
      expect(
        find.text(
          'Căn BDS-000001 hợp với khách: đúng phường, trong ngân sách.',
        ),
        findsOneWidget,
      );
      expect(find.text('BDS-000001 · Nhà phố Vĩnh Hải'), findsOneWidget);
      expect(find.text('3,5 tỷ · 70,5 m²'), findsOneWidget);
      expect(find.text('Trần Thị Bình'), findsOneWidget);
      expect(find.text('K1'), findsOneWidget);
      // Đã hỏi thì ẩn câu gợi ý.
      expect(find.text('Căn nào dễ thương lượng?'), findsNothing);

      await tester.enterText(
        find.byKey(const Key('copilot-input')),
        '  Còn căn nào rẻ hơn?  ',
      );
      await tester.tap(find.byTooltip('Gửi'));
      await tester.pumpAndSettle();
      expect(ai.copilotCalls, hasLength(2));
      expect(
        [for (final turn in ai.copilotCalls.last.$1) turn.toJson()],
        [
          {'role': 'user', 'content': 'Khách nào cần follow-up hôm nay?'},
          {
            'role': 'assistant',
            'content':
                'Căn BDS-000001 hợp với khách: đúng phường, trong ngân sách.',
          },
          {'role': 'user', 'content': 'Còn căn nào rẻ hơn?'},
        ],
      );

      await tester.tap(find.byKey(const Key('copilot-property-p1')).first);
      await tester.pumpAndSettle();
      expect(location(router), AppRoutes.propertyDetail('p1'));
      // Quay lại vẫn còn hội thoại.
      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('Còn căn nào rẻ hơn?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('copilot-customer-c1')).first);
      await tester.pumpAndSettle();
      expect(location(router), AppRoutes.customerDetail('c1'));
    },
  );

  testWidgets('từ chi tiết khách: gửi kèm khách đang xem, gợi ý theo khách', (
    tester,
  ) async {
    final router = await open(tester);
    router.go(AppRoutes.customerDetail('c1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hỏi Copilot'));
    await tester.pumpAndSettle();
    expect(find.text('Đang hỏi về khách này'), findsOneWidget);
    for (final suggestion in copilotSuggestions.customer) {
      expect(find.text(suggestion), findsOneWidget);
    }
    await tester.tap(find.text('Tìm nhà phù hợp khách này'));
    await tester.pumpAndSettle();
    expect(ai.copilotCalls.single.$2.toJson(), {'customerId': 'c1'});
  });

  testWidgets('từ chi tiết BĐS: gửi kèm BĐS đang xem', (tester) async {
    final router = await open(tester);
    router.go(AppRoutes.propertyDetail('p1'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Hỏi Copilot'));
    await tester.pumpAndSettle();
    expect(find.text('Đang hỏi về BĐS này'), findsOneWidget);
    await tester.tap(find.text('Viết tin cho căn này'));
    await tester.pumpAndSettle();
    expect(ai.copilotCalls.single.$2.toJson(), {'propertyId': 'p1'});
  });

  testWidgets(
    'lỗi: bỏ câu hỏi khỏi hội thoại, trả lại ô nhập; "Thử lại" gửi lại',
    (tester) async {
      var fail = true;
      ai.onCopilot = (history) async {
        if (fail) {
          throw const ApiException(
            code: ErrorCodes.serviceUnavailable,
            message: 'AI chưa trả lời được, vui lòng thử lại',
          );
        }
        return const CopilotTurn.assistant('Có 2 khách cần gọi hôm nay.');
      };
      final router = await open(tester);
      unawaited(router.push(AppRoutes.copilot()));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('copilot-input')), 'Chào em');
      await tester.tap(find.byTooltip('Gửi'));
      await tester.pumpAndSettle();
      expect(
        find.text('AI chưa trả lời được, vui lòng thử lại'),
        findsOneWidget,
      );
      final input = tester.widget<TextField>(
        find.byKey(const Key('copilot-input')),
      );
      expect(input.controller?.text, 'Chào em');
      // Câu hỏi lỗi không nằm trong hội thoại: câu gợi ý vẫn hiện.
      expect(find.text('Căn nào dễ thương lượng?'), findsOneWidget);

      fail = false;
      await tester.tap(find.text('Thử lại'));
      await tester.pumpAndSettle();
      expect(ai.copilotCalls, hasLength(2));
      expect(ai.copilotCalls.last.$1, hasLength(1));
      expect(find.text('Có 2 khách cần gọi hôm nay.'), findsOneWidget);
      expect(find.text('AI chưa trả lời được, vui lòng thử lại'), findsNothing);
    },
  );

  testWidgets('hội thoại dài chỉ gửi 19 lượt gần nhất, bắt đầu bằng câu hỏi', (
    tester,
  ) async {
    ai.onCopilot = (history) async =>
        CopilotTurn.assistant('Trả lời ${history.length}');
    final router = await open(tester);
    unawaited(router.push(AppRoutes.copilot()));
    await tester.pumpAndSettle();
    for (var i = 1; i <= 11; i++) {
      await tester.enterText(find.byKey(const Key('copilot-input')), 'Câu $i');
      await tester.tap(find.byTooltip('Gửi'));
      await tester.pumpAndSettle();
    }
    final sent = ai.copilotCalls.last.$1;
    expect(sent, hasLength(copilotHistoryLimit));
    expect(sent.first.fromUser, isTrue);
    expect(sent.first.content, 'Câu 2');
    expect(sent.last.content, 'Câu 11');
  });
}
