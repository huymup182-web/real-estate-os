import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/ai/domain/ai_customer_summary.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/presentation/ai_providers.dart';
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
  late FakeCustomersRepository customers;
  late FakeAiRepository ai;

  setUp(() {
    customers = FakeCustomersRepository();
    ai = FakeAiRepository();
  });

  Future<void> open(WidgetTester tester) async {
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
                permissions: const {'customer.view': 'OWN'},
              ),
            ),
          ),
          customersRepositoryProvider.overrideWithValue(customers),
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
    GoRouter.of(tester.element(find.byType(NavigationBar)))
        .go(AppRoutes.customerDetail('c1'));
    await tester.pumpAndSettle();
  }

  testWidgets('AI tắt thì không có nút "AI tóm tắt"', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    await open(tester);
    expect(find.text('Trần Thị Bình'), findsWidgets);
    expect(find.text('AI tóm tắt'), findsNothing);
  });

  testWidgets(
    '"AI tóm tắt" gọi AI một lần, hiện tóm tắt, ý chính, câu nên hỏi',
    (tester) async {
      await open(tester);
      // Không có customer.edit: chỉ có nút AI, không có "Đổi bước".
      expect(find.text('Đổi bước'), findsNothing);
      expect(ai.summaries, isEmpty);
      await tester.tap(find.text('AI tóm tắt'));
      await tester.pumpAndSettle();
      expect(ai.summaries, ['c1']);
      expect(
        find.text(
          'Khách cần nhà phố ở Vĩnh Hải 4–6 tỷ, đã hẹn xem nhà cuối tuần.',
        ),
        findsOneWidget,
      );
      expect(find.text('Ý chính'), findsOneWidget);
      expect(find.text('Muốn gần trường học.'), findsOneWidget);
      expect(find.text('Nên hỏi thêm'), findsOneWidget);
      expect(find.text('Khách cần mấy phòng tắm?'), findsOneWidget);
      expect(find.textContaining('2 hoạt động gần nhất'), findsOneWidget);
    },
  );

  testWidgets('AI lỗi thì "Thử lại" gọi lại', (tester) async {
    var fail = true;
    ai.onSummary = (customerId) async {
      if (fail) {
        throw const ApiException(
          code: ErrorCodes.serviceUnavailable,
          message: 'AI chưa tóm tắt được khách, vui lòng thử lại',
        );
      }
      return const AiCustomerSummary(summary: 'Khách mới, chưa có nhu cầu.');
    };
    await open(tester);
    await tester.tap(find.text('AI tóm tắt'));
    await tester.pumpAndSettle();
    expect(find.text('Thử lại'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Khách mới, chưa có nhu cầu.'), findsOneWidget);
    expect(find.text('Ý chính'), findsNothing);
    expect(ai.summaries, hasLength(2));
  });
}
