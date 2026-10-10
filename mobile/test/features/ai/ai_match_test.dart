import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/ai/domain/ai_match.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/presentation/ai_providers.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/customers/domain/property_match.dart';
import 'package:real_estate_os/features/customers/presentation/customer_list_controller.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_ai.dart';
import '../../support/fake_auth.dart';
import '../../support/fake_customers.dart';
import '../../support/fake_locations.dart';
import '../../support/fake_properties.dart';

PropertyMatch _match(int n, {int score = 88}) => PropertyMatch.fromJson({
  'property': {
    'id': 'p$n',
    'code': 'BDS-00$n',
    'title': 'Nhà phố số $n',
    'propertyType': 'HOUSE',
    'transactionType': 'SALE',
    'price': 4800000000,
    'area': 72.5,
  },
  'preferenceId': 'pref1',
  'score': score,
  'criteria': <Object>[],
  'explanation': {'summary': '$score% phù hợp vì đúng ngân sách và khu vực.'},
});

void main() {
  late FakeCustomersRepository customers;
  late FakePropertiesRepository properties;
  late FakeAiRepository ai;
  var user = testUser;

  setUp(() {
    user = CurrentUser(
      id: testUser.id,
      fullName: testUser.fullName,
      permissions: const {'customer.view': 'ALL', 'property.view': 'ALL'},
    );
    customers = FakeCustomersRepository()
      ..onMatches = (id) async => [_match(1), _match(2, score: 64)];
    properties = FakePropertiesRepository();
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
            FakeAuthRepository(() async => user),
          ),
          customersRepositoryProvider.overrideWithValue(customers),
          propertiesRepositoryProvider.overrideWithValue(properties),
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

  testWidgets(
    'chi tiết khách có mục "BĐS phù hợp": điểm, giá, lời giải thích theo luật',
    (tester) async {
      await open(tester);
      expect(customers.matchCalls, ['c1']);
      expect(find.text('BĐS phù hợp'), findsOneWidget);
      expect(find.text('BDS-001 · Nhà phố số 1'), findsOneWidget);
      expect(find.text('88%'), findsOneWidget);
      expect(find.text('64%'), findsOneWidget);
      expect(
        find.text('4,8 tỷ · 72,5 m² · Nhà phố, nhà riêng'),
        findsNWidgets(2),
      );
      expect(
        find.text('88% phù hợp vì đúng ngân sách và khu vực.'),
        findsOneWidget,
      );
      expect(find.text('AI giải thích'), findsNWidgets(2));
      expect(ai.explanations, isEmpty);

      await tester.tap(find.text('BDS-002 · Nhà phố số 2'));
      await tester.pumpAndSettle();
      expect(properties.detailCalls, ['p2']);
    },
  );

  testWidgets(
    '"AI giải thích" gọi AI một lần, hiện điểm, điểm hợp, lưu ý, câu gợi ý',
    (tester) async {
      await open(tester);
      final statusCalls = ai.statusCalls;
      await tester.tap(
        find.descendant(
          of: find.byKey(const Key('match-p1')),
          matching: find.text('AI giải thích'),
        ),
      );
      await tester.pumpAndSettle();
      expect(ai.explanations, [('c1', 'p1')]);
      expect(find.text('BDS-001 · Nhà phố số 1'), findsNWidgets(2));
      expect(find.byKey(const Key('ai-match-score')), findsOneWidget);
      expect(
        find.text('Nhà hợp ngân sách và khu vực khách cần.'),
        findsOneWidget,
      );
      expect(
        find.text('Giá 4,8 tỷ nằm trong ngân sách 4–5 tỷ.'),
        findsOneWidget,
      );
      expect(
        find.text('Hướng Tây, khách chưa nêu hướng: nên hỏi thêm.'),
        findsOneWidget,
      );
      expect(
        find.text('Căn này đúng tầm giá anh chị đang tìm.'),
        findsOneWidget,
      );
      // Lượt AI đã dùng: tải lại số lượt còn lại.
      expect(ai.statusCalls, greaterThan(statusCalls));
    },
  );

  testWidgets(
    'AI lỗi thì báo lỗi, "Thử lại" gọi lại; khách chưa có nhu cầu thì báo rõ',
    (tester) async {
      var fail = true;
      ai.onExplain = (customerId, propertyId) async {
        if (fail) {
          throw const ApiException(
            code: ErrorCodes.serviceUnavailable,
            message: 'AI chưa viết được lời giải thích, vui lòng thử lại',
          );
        }
        return const AiMatchExplanation(score: 70, summary: 'Hợp khu vực.');
      };
      await open(tester);
      await tester.tap(find.text('AI giải thích').first);
      await tester.pumpAndSettle();
      expect(find.text('Thử lại'), findsOneWidget);

      fail = false;
      await tester.tap(find.text('Thử lại'));
      await tester.pumpAndSettle();
      expect(find.text('Hợp khu vực.'), findsOneWidget);
      expect(find.text('Điểm hợp'), findsNothing);
      expect(ai.explanations, hasLength(2));

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      ai.onExplain = (customerId, propertyId) async => throw const ApiException(
        code: ErrorCodes.businessRuleViolation,
        message:
            'Khách chưa có nhu cầu đang bật cùng loại giao dịch với BĐS này',
      );
      await tester.tap(find.text('AI giải thích').first);
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Khách chưa có nhu cầu đang bật cùng loại giao dịch với BĐS này',
        ),
        findsOneWidget,
      );
      expect(find.text('Thử lại'), findsNothing);
    },
  );

  testWidgets('AI tắt thì không có nút "AI giải thích"', (tester) async {
    ai.currentStatus = const AiStatus(enabled: false);
    await open(tester);
    expect(find.text('88%'), findsOneWidget);
    expect(find.text('AI giải thích'), findsNothing);
  });

  testWidgets('không có BĐS phù hợp thì báo', (tester) async {
    customers.onMatches = (id) async => const [];
    await open(tester);
    expect(
      find.text('Chưa có BĐS đang bán nào phù hợp với nhu cầu của khách.'),
      findsOneWidget,
    );
  });

  testWidgets(
    'không có property.view thì không có mục "BĐS phù hợp", không gọi API',
    (tester) async {
      user = CurrentUser(
        id: testUser.id,
        fullName: testUser.fullName,
        permissions: const {'customer.view': 'ALL'},
      );
      await open(tester);
      expect(find.text('BĐS phù hợp'), findsNothing);
      expect(customers.matchCalls, isEmpty);
    },
  );
}
