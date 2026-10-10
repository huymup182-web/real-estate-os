import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/notifications/presentation/notifications_controller.dart';
import 'package:real_estate_os/features/teams/data/teams_repository.dart';
import 'package:real_estate_os/features/teams/presentation/team_providers.dart';

import '../../support/fake_adapter.dart';
import '../../support/fake_auth.dart';
import '../../support/fake_notifications.dart';
import '../../support/fake_teams.dart';

const _agent = CurrentUser(
  id: 'u1',
  fullName: 'Nguyễn Văn An',
  email: 'an@demo.vn',
  permissions: {'team.view': 'TEAM'},
);

void main() {
  late FakeTeamsRepository teams;
  var user = _agent;

  setUp(() {
    teams = FakeTeamsRepository();
    user = _agent;
  });

  Future<void> open(
    WidgetTester tester, {
    Size size = const Size(1200, 3000),
    bool openTeams = true,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => user),
          ),
          notificationsRepositoryProvider.overrideWithValue(
            FakeNotificationsRepository(),
          ),
          teamsRepositoryProvider.overrideWithValue(teams),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Tài khoản'),
      ),
    );
    await tester.pumpAndSettle();
    if (openTeams) {
      await tester.tap(find.text('Nhóm'));
      await tester.pumpAndSettle();
    }
  }

  test('GET /teams và /teams/:id', () async {
    final adapter = FakeAdapter(
      (options) => (
        200,
        {
          'success': true,
          'message': null,
          'data': options.path == '/teams'
              ? [
                  {
                    'id': 't1',
                    'name': 'Nhóm Vĩnh Hải',
                    'department': {'id': 'd1', 'name': 'Kinh doanh'},
                    'leader': null,
                    'memberCount': 2,
                  },
                ]
              : {
                  'id': 't1',
                  'name': 'Nhóm Vĩnh Hải',
                  'department': {'id': 'd1', 'name': 'Kinh doanh'},
                  'leader': {'id': 'u2', 'fullName': 'Lê Thị Bình'},
                  'memberCount': 1,
                  'members': [
                    {
                      'id': 'u2',
                      'fullName': 'Lê Thị Bình',
                      'email': null,
                      'status': 'ACTIVE',
                    },
                  ],
                  'canManage': false,
                },
        },
      ),
    );
    final repository = TeamsRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );
    final list = await repository.list();
    expect(list.single.departmentName, 'Kinh doanh');
    expect(list.single.leaderName, isNull);
    final detail = await repository.detail('t1');
    expect(detail.summary.leaderName, 'Lê Thị Bình');
    expect(detail.members.single.email, isNull);
    expect(adapter.requests.map((r) => r.options.path), [
      '/teams',
      '/teams/t1',
    ]);
  });

  testWidgets('không có team.view: tab Tài khoản không có mục Nhóm', (
    tester,
  ) async {
    user = testUser;
    await open(tester, openTeams: false);
    expect(find.text('Nhóm'), findsNothing);
    expect(teams.listCalls, 0);
  });

  testWidgets('danh sách nhóm: phòng ban, trưởng nhóm, số thành viên', (
    tester,
  ) async {
    await open(tester);
    expect(find.widgetWithText(AppBar, 'Nhóm'), findsOneWidget);
    expect(find.text('Nhóm Vĩnh Hải'), findsOneWidget);
    expect(find.text('Kinh doanh Nha Trang'), findsOneWidget);
    expect(
      find.text('Trưởng nhóm: Lê Thị Bình · 3 thành viên'),
      findsOneWidget,
    );
    expect(find.text('Trưởng nhóm: chưa có · 0 thành viên'), findsOneWidget);
  });

  testWidgets(
    'chi tiết nhóm: trưởng nhóm lên đầu, đánh dấu bạn, tài khoản bị khoá',
    (tester) async {
      await open(tester);
      await tester.tap(find.text('Nhóm Vĩnh Hải'));
      await tester.pumpAndSettle();
      expect(teams.detailCalls, ['t1']);
      expect(find.widgetWithText(AppBar, 'Nhóm Vĩnh Hải'), findsOneWidget);
      expect(find.text('Số thành viên'), findsOneWidget);
      expect(find.text('Nguyễn Văn An (bạn)'), findsOneWidget);
      expect(find.text('Đã khoá'), findsOneWidget);
      expect(find.text('Trưởng nhóm'), findsNWidgets(2));
      final leaderY = tester.getTopLeft(find.text('binh@demo.vn')).dy;
      final meY = tester.getTopLeft(find.text('an@demo.vn')).dy;
      expect(leaderY, lessThan(meY));
    },
  );

  testWidgets('nhóm chưa có thành viên', (tester) async {
    await open(tester);
    await tester.tap(find.text('Nhóm Đà Lạt'));
    await tester.pumpAndSettle();
    expect(find.text('Nhóm chưa có thành viên.'), findsOneWidget);
    expect(find.text('Chưa có'), findsOneWidget);
  });

  testWidgets('chưa thuộc nhóm nào', (tester) async {
    teams.teams = const [];
    await open(tester);
    expect(find.text('Bạn chưa thuộc nhóm nào.'), findsOneWidget);
  });

  testWidgets('lỗi tải danh sách: thử lại; kéo xuống tải lại', (tester) async {
    teams.failList = const ApiException(
      code: ErrorCodes.networkError,
      message: 'Không kết nối được máy chủ',
    );
    await open(tester);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    teams.failList = null;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Nhóm Vĩnh Hải'), findsOneWidget);

    await tester.fling(find.text('Nhóm Vĩnh Hải'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(teams.listCalls, 3);
  });

  testWidgets('nhóm không xem được (404): báo rõ', (tester) async {
    teams.failDetail = const ApiException(
      code: ErrorCodes.notFound,
      message: 'Không tìm thấy',
    );
    await open(tester);
    await tester.tap(find.text('Nhóm Vĩnh Hải'));
    await tester.pumpAndSettle();
    expect(
      find.text('Không tìm thấy nhóm, hoặc bạn không có quyền xem nhóm này.'),
      findsOneWidget,
    );
  });

  testWidgets('màn hình hẹp, chữ to: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, size: const Size(960, 2400)); // 320 x 800.
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Nhóm Vĩnh Hải'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
