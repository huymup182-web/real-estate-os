import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/clock.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/format/vn_format.dart';
import 'package:real_estate_os/features/appointments/presentation/calendar_controller.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/home/presentation/home_providers.dart';

import '../../support/fake_appointments.dart';
import '../../support/fake_auth.dart';
import '../../support/fake_home.dart';

const _viewer = CurrentUser(
  id: 'u1',
  fullName: 'Nguyễn Văn An',
  permissions: {'appointment.view': 'OWN'},
);

const _manager = CurrentUser(
  id: 'u1',
  fullName: 'Nguyễn Văn An',
  permissions: {'appointment.view': 'OWN', 'appointment.manage': 'OWN'},
);

void main() {
  // 08:00 thứ 6, 16/10/2026 giờ Việt Nam.
  final now = DateTime.utc(2026, 10, 16, 1);
  late FakeAppointmentsRepository repository;
  late FakeHomeRepository home;

  setUp(() {
    home = FakeHomeRepository();
    repository = FakeAppointmentsRepository([
      // 00:30 ngày 16/10 giờ Việt Nam (UTC vẫn là ngày 15), đã qua giờ hẹn.
      appointment('a0', DateTime.utc(2026, 10, 15, 17, 30)),
      // 09:30–10:30 ngày 16/10, chưa tới giờ.
      appointment(
        'a1',
        DateTime.utc(2026, 10, 16, 2, 30),
        customerName: 'Lê Văn Cường',
      ),
      // 23:30 ngày 15/10.
      appointment(
        'a2',
        DateTime.utc(2026, 10, 15, 16, 30),
        status: 'COMPLETED',
        outcome: 'INTERESTED',
        durationMinutes: null,
        location: null,
      ),
      appointment('a3', DateTime.utc(2026, 11, 2, 3)),
    ]);
  });

  Future<void> open(
    WidgetTester tester, {
    CurrentUser user = _manager,
    Size size = const Size(1200, 4000),
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
          homeRepositoryProvider.overrideWithValue(home),
          appointmentsRepositoryProvider.overrideWithValue(repository),
          clockProvider.overrideWithValue(() => now),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Lịch hẹn'));
    await tester.pumpAndSettle();
  }

  Finder day(String label) => find.bySemanticsLabel(label);

  test('vnDayStart, vnWeekdayDate theo giờ Việt Nam', () {
    expect(vnDayStart(2026, 10, 1), DateTime.utc(2026, 9, 30, 17));
    expect(vnDayStart(2026, 13, 1), DateTime.utc(2026, 12, 31, 17));
    expect(
      vnWeekdayDate(DateTime.utc(2026, 10, 15, 17, 30)),
      'Thứ 6, 16/10/2026',
    );
    expect(vnToday(DateTime.utc(2026, 10, 15, 17)), DateTime.utc(2026, 10, 16));
  });

  testWidgets(
    'mở từ trang chủ: tháng này, chọn hôm nay, nhóm lịch theo ngày giờ Việt Nam',
    (tester) async {
      await open(tester);
      expect(find.widgetWithText(AppBar, 'Lịch hẹn'), findsOneWidget);
      expect(find.text('Tháng 10/2026'), findsOneWidget);
      expect(repository.ranges.single, (
        DateTime.utc(2026, 9, 30, 17),
        DateTime.utc(2026, 10, 31, 17),
      ));
      expect(find.text('Thứ 6, 16/10/2026 · 2 lịch hẹn'), findsOneWidget);
      expect(day('16/10, hôm nay, 2 lịch hẹn'), findsOneWidget);
      expect(day('15/10, 1 lịch hẹn'), findsOneWidget);
      expect(day('1/10, không có lịch hẹn'), findsOneWidget);
      expect(find.text('00:30 – 01:30'), findsOneWidget);
      expect(find.text('09:30 – 10:30'), findsOneWidget);
      expect(find.text('Lê Văn Cường'), findsOneWidget);
      // Thứ 5 (1/10) nằm ở cột thứ 4 của tuần đầu.
      expect(
        tester.getCenter(day('1/10, không có lịch hẹn')).dx,
        closeTo(tester.getCenter(find.text('T5')).dx, 1),
      );
    },
  );

  testWidgets('chọn ngày khác: hiện lịch ngày đó, ngày trống thì báo', (
    tester,
  ) async {
    await open(tester);
    await tester.tap(day('15/10, 1 lịch hẹn'));
    await tester.pumpAndSettle();
    expect(find.text('Thứ 5, 15/10/2026 · 1 lịch hẹn'), findsOneWidget);
    expect(find.text('23:30'), findsOneWidget);
    expect(find.text('Đã xem'), findsOneWidget);
    expect(find.text('Kết quả: Quan tâm'), findsOneWidget);

    await tester.tap(day('1/10, không có lịch hẹn'));
    await tester.pumpAndSettle();
    expect(find.text('Thứ 5, 01/10/2026 · 0 lịch hẹn'), findsOneWidget);
    expect(find.text('Không có lịch hẹn nào trong ngày này.'), findsOneWidget);
  });

  testWidgets('chuyển tháng, về hôm nay', (tester) async {
    await open(tester);
    await tester.tap(find.byTooltip('Tháng sau'));
    await tester.pumpAndSettle();
    expect(find.text('Tháng 11/2026'), findsOneWidget);
    expect(repository.ranges.last, (
      DateTime.utc(2026, 10, 31, 17),
      DateTime.utc(2026, 11, 30, 17),
    ));
    expect(find.text('Chủ nhật, 01/11/2026 · 0 lịch hẹn'), findsOneWidget);
    expect(day('2/11, 1 lịch hẹn'), findsOneWidget);

    await tester.tap(find.byTooltip('Tháng trước'));
    await tester.tap(find.byTooltip('Tháng trước'));
    await tester.pumpAndSettle();
    expect(find.text('Tháng 9/2026'), findsOneWidget);
    expect(find.text('Thứ 3, 01/09/2026 · 0 lịch hẹn'), findsOneWidget);

    await tester.tap(find.byTooltip('Hôm nay'));
    await tester.pumpAndSettle();
    expect(find.text('Tháng 10/2026'), findsOneWidget);
    expect(find.text('Thứ 6, 16/10/2026 · 2 lịch hẹn'), findsOneWidget);
  });

  testWidgets('huỷ lịch: chưa tới giờ thì không chọn được "Đã xem"', (
    tester,
  ) async {
    await open(tester);
    await tester.tap(find.text('Lê Văn Cường'));
    await tester.pumpAndSettle();
    expect(find.text('Đổi trạng thái'), findsOneWidget);
    expect(find.text('Chưa tới giờ hẹn'), findsNWidgets(2));
    final completed = tester.widget<RadioListTile<String>>(
      find.widgetWithText(RadioListTile<String>, 'Đã xem'),
    );
    expect(completed.enabled, isFalse);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Lưu'))
          .onPressed,
      isNull,
    );

    await tester.tap(find.widgetWithText(RadioListTile<String>, 'Đã huỷ'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Lưu'));
    await tester.pumpAndSettle();

    expect(repository.statusChanges.single, (
      id: 'a1',
      status: 'CANCELLED',
      outcome: null,
      expected: DateTime.utc(2026, 10, 1),
    ));
    expect(find.text('Đã chuyển lịch hẹn sang "Đã huỷ".'), findsOneWidget);
    expect(repository.ranges, hasLength(2));
    expect(find.text('Đã huỷ'), findsOneWidget);

    // Về trang chủ: lịch hẹn sắp tới được tải lại.
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(home.appointmentCalls, 2);
  });

  testWidgets('đã qua giờ hẹn: đánh dấu đã xem kèm kết quả', (tester) async {
    await open(tester);
    await tester.tap(find.text('00:30 – 01:30'));
    await tester.pumpAndSettle();
    expect(find.text('Chưa tới giờ hẹn'), findsNothing);
    await tester.tap(find.widgetWithText(RadioListTile<String>, 'Đã xem'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Chưa ghi'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cần chăm sóc thêm').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Lưu'));
    await tester.pumpAndSettle();

    expect(repository.statusChanges.single.status, 'COMPLETED');
    expect(repository.statusChanges.single.outcome, 'NEED_FOLLOW_UP');
    expect(find.text('Kết quả: Cần chăm sóc thêm'), findsOneWidget);
  });

  testWidgets('chỉ có quyền xem: bảng chi tiết không cho đổi trạng thái', (
    tester,
  ) async {
    await open(tester, user: _viewer);
    await tester.tap(find.text('Lê Văn Cường'));
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố Vĩnh Hải'), findsNothing);
    expect(find.text('BDS-0001 · Nhà phố Vĩnh Hải'), findsNWidgets(3));
    expect(find.text('Số 1 Đường 2/4'), findsNWidgets(3));
    expect(find.text('Đổi trạng thái'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Lưu'), findsNothing);
  });

  testWidgets('người khác vừa sửa (409): báo và tải lại lịch', (tester) async {
    repository.onChangeStatus = (id, status, outcome) async =>
        throw const ApiException(
          code: ErrorCodes.conflict,
          message: 'Lịch hẹn đã được người khác cập nhật',
        );
    await open(tester);
    await tester.tap(find.text('Lê Văn Cường'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(RadioListTile<String>, 'Đã huỷ'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Lưu'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Lịch hẹn vừa được người khác cập nhật. Đã tải lại, vui lòng thử lại.',
      ),
      findsOneWidget,
    );
    expect(repository.ranges, hasLength(2));
  });

  testWidgets('lỗi khác (chưa tới giờ hẹn): báo lỗi, không tải lại', (
    tester,
  ) async {
    repository.onChangeStatus = (id, status, outcome) async =>
        throw const ApiException(
          code: ErrorCodes.businessRuleViolation,
          message: 'Chưa tới giờ hẹn, chưa đánh dấu đã xem hoặc khách không đến được',
        );
    await open(tester);
    await tester.tap(find.text('Lê Văn Cường'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(RadioListTile<String>, 'Đã huỷ'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Lưu'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Chưa tới giờ hẹn, chưa đánh dấu đã xem hoặc khách không đến được',
      ),
      findsOneWidget,
    );
    expect(repository.ranges, hasLength(1));
  });

  testWidgets('lỗi tải lịch: hiện lỗi, thử lại', (tester) async {
    var fail = true;
    repository.onRange = (from, to) async {
      if (fail) {
        throw const ApiException(
          code: ErrorCodes.networkError,
          message: 'Không kết nối được máy chủ',
        );
      }
      return [];
    };
    await open(tester);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    expect(find.text('Thứ 6, 16/10/2026'), findsOneWidget);

    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Không có lịch hẹn nào trong ngày này.'), findsOneWidget);
  });

  testWidgets('kéo xuống tải lại', (tester) async {
    await open(tester);
    await tester.fling(find.text('Tháng 10/2026'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(repository.ranges, hasLength(2));
  });

  testWidgets('không có quyền xem lịch hẹn: trang chủ không có lối vào lịch', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 4000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => testUser),
          ),
          homeRepositoryProvider.overrideWithValue(home),
          clockProvider.overrideWithValue(() => now),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('Lịch hẹn'), findsNothing);
    expect(find.text('Xem lịch'), findsNothing);
  });

  testWidgets('nút "Xem lịch" ở trang chủ mở lịch', (tester) async {
    await open(tester);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Xem lịch'));
    await tester.pumpAndSettle();
    expect(find.text('Tháng 10/2026'), findsOneWidget);
  });

  testWidgets('màn hình hẹp, chữ to: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, size: const Size(960, 2400)); // 320 x 800.
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Lê Văn Cường'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lê Văn Cường'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Đổi trạng thái'), findsOneWidget);
  });
}
