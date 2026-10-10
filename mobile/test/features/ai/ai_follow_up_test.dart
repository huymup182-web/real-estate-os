import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/ai/domain/ai_follow_up.dart';
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
    customers = FakeCustomersRepository(
      (page) async => customerPage([customer(1)], total: 1),
    );
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
        .go(AppRoutes.customers);
    await tester.pumpAndSettle();
  }

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byTooltip('Khách cần chăm sóc'));
    await tester.pumpAndSettle();
  }

  testWidgets('AI tắt thì không có nút "Khách cần chăm sóc"', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    await open(tester);
    expect(find.text('1 khách'), findsOneWidget);
    expect(find.byTooltip('Khách cần chăm sóc'), findsNothing);
  });

  testWidgets('hiện khách cần chăm sóc và gợi ý; chạm tên mở chi tiết khách', (
    tester,
  ) async {
    await open(tester);
    expect(ai.followUpCalls, 0);
    await openSheet(tester);
    expect(ai.followUpCalls, 1);
    expect(
      find.textContaining('quá 14 ngày chưa có hoạt động'),
      findsOneWidget,
    );
    expect(find.text('16 ngày chưa chăm sóc'), findsOneWidget);
    expect(
      find.text('Gọi điện: Khách đã đi xem, 16 ngày chưa gọi.'),
      findsOneWidget,
    );
    expect(
      find.text('"Em chào chị, chị còn quan tâm căn Vĩnh Hải không ạ?"'),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('follow-up-c2')),
        matching: find.text('AI chưa có gợi ý cho khách này.'),
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('Lê Văn Cường'));
    await tester.pumpAndSettle();
    expect(customers.detailCalls, ['c2']);
    expect(find.text('Khách cần chăm sóc'), findsNothing);
  });

  testWidgets('không có khách cần chăm sóc thì báo; lỗi thì "Thử lại"', (
    tester,
  ) async {
    var fail = true;
    ai.onFollowUps = () async {
      if (fail) {
        throw const ApiException(
          code: ErrorCodes.serviceUnavailable,
          message: 'AI chưa gợi ý được việc chăm sóc, vui lòng thử lại',
        );
      }
      return const AiFollowUps(thresholdDays: 14);
    };
    await open(tester);
    await openSheet(tester);
    expect(find.text('Thử lại'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Thử lại'));
    await tester.pumpAndSettle();
    expect(
      find.text('Không có khách nào quá 14 ngày chưa chăm sóc.'),
      findsOneWidget,
    );
  });
}
