import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/clock.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/home/domain/home_summary.dart';
import 'package:real_estate_os/features/home/presentation/home_providers.dart';
import 'package:real_estate_os/features/home/presentation/home_screen.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_home.dart';

const agent = CurrentUser(
  id: 'u1',
  fullName: 'Nguyễn Văn An',
  companyName: 'Công ty BĐS Demo',
  permissions: {'report.view': 'OWN', 'appointment.view': 'OWN'},
);

void main() {
  // 08:00 ngày 10/10/2026 giờ Việt Nam.
  final now = DateTime.utc(2026, 10, 10, 1);
  late FakeHomeRepository home;

  Future<void> open(WidgetTester tester, CurrentUser user) async {
    // Màn hình điện thoại cao, để thấy hết các phần.
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => user),
          ),
          homeRepositoryProvider.overrideWithValue(home),
          clockProvider.overrideWithValue(() => now),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
  }

  setUp(() => home = FakeHomeRepository());

  test('lời chào theo giờ Việt Nam, gọi bằng tên', () {
    expect(greeting(DateTime.utc(2026, 10, 10, 1)), 'Chào buổi sáng');
    expect(greeting(DateTime.utc(2026, 10, 10, 6)), 'Chào buổi chiều');
    expect(greeting(DateTime.utc(2026, 10, 10, 14)), 'Chào buổi tối');
    expect(firstName('Nguyễn Văn An'), 'An');
    expect(firstName('  '), 'bạn');
  });

  testWidgets('hiện lời chào, số liệu, lịch hẹn sắp tới', (tester) async {
    await open(tester, agent);

    expect(find.text('Chào buổi sáng, An'), findsOneWidget);
    expect(find.text('Công ty BĐS Demo'), findsOneWidget);
    expect(find.text('1.234'), findsOneWidget);
    expect(find.text('BĐS đang bán'), findsOneWidget);
    expect(find.text('Giao dịch thành công'), findsOneWidget);
    expect(find.text('Trần Thị Bình'), findsOneWidget);
    expect(find.text('09:30'), findsOneWidget);
    expect(find.text('Hôm nay'), findsOneWidget);
    expect(home.appointmentsFrom, now);
  });

  testWidgets('không có quyền: ẩn số liệu và lịch hẹn, không gọi API', (
    tester,
  ) async {
    await open(tester, testUser);
    expect(find.text('30 ngày gần nhất'), findsNothing);
    expect(find.text('Lịch hẹn sắp tới'), findsNothing);
    expect(home.statsCalls, 0);
    expect(home.appointmentCalls, 0);
  });

  testWidgets('chưa có lịch hẹn: báo trống', (tester) async {
    home.onAppointments = () async => [];
    await open(tester, agent);
    expect(find.text('Chưa có lịch hẹn nào sắp tới.'), findsOneWidget);
  });

  testWidgets('lỗi tải số liệu: hiện lỗi, bấm thử lại tải lại', (tester) async {
    var fail = true;
    home.onStats = () async {
      if (fail) {
        throw const ApiException(
          code: ErrorCodes.networkError,
          message: 'Không kết nối được máy chủ',
        );
      }
      return const DashboardStats(
        activeProperties: 3,
        newCustomers: 0,
        viewings: 0,
        wonDeals: 0,
      );
    };
    await open(tester, agent);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    expect(find.text('Trần Thị Bình'), findsOneWidget);

    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Không kết nối được máy chủ'), findsNothing);
    expect(home.statsCalls, 2);
  });

  testWidgets('kéo xuống tải lại', (tester) async {
    await open(tester, agent);
    await tester.fling(
      find.text('Chào buổi sáng, An'),
      const Offset(0, 400),
      1000,
    );
    await tester.pumpAndSettle();
    expect(home.statsCalls, 2);
    expect(home.appointmentCalls, 2);
  });

  testWidgets('màn hình hẹp, chữ to: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, agent);
    tester.view.physicalSize = const Size(960, 2400); // 320 x 800.
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('1.234'), findsOneWidget);
  });
}
