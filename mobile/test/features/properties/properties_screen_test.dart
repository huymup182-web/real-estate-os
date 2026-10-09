import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/properties/presentation/properties_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_properties.dart';

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được máy chủ',
);

void main() {
  late FakePropertiesRepository repository;

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [propertiesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const PropertiesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'hiện tổng số và thẻ BĐS: giá gọn, diện tích, phòng, vị trí, mã, trạng thái',
    (tester) async {
      repository = FakePropertiesRepository(
        (page) async =>
            pageOf([property(1), property(2, status: 'SOLD')], total: 2),
      );
      await open(tester);

      expect(find.text('2 BĐS'), findsOneWidget);
      expect(find.text('Nhà phố số 1'), findsOneWidget);
      expect(find.text('3,5 tỷ'), findsWidgets);
      expect(
        find.text('70,5 m² · 3 PN · 2 WC · Nhà phố, nhà riêng'),
        findsWidgets,
      );
      expect(find.text('Vĩnh Hải, Khánh Hòa'), findsWidgets);
      expect(find.text('BDS-000001'), findsOneWidget);
      expect(find.text('Đang bán'), findsOneWidget);
      expect(find.text('Đã bán'), findsOneWidget);
      expect(repository.listedPages, [1]);
    },
  );

  testWidgets('cuộn tới cuối thì tải trang sau, hết trang thì dừng', (
    tester,
  ) async {
    repository = FakePropertiesRepository(
      (page) async => pageOf(
        [for (var i = 1; i <= 20; i++) property((page - 1) * 20 + i)],
        page: page,
        total: 40,
      ),
    );
    await open(tester);
    expect(repository.listedPages, [1]);

    await tester.scrollUntilVisible(
      find.text('Nhà phố số 40'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(repository.listedPages, [1, 2]);
    expect(find.text('Nhà phố số 40'), findsOneWidget);
  });

  testWidgets('chưa có BĐS: báo trống', (tester) async {
    repository = FakePropertiesRepository();
    await open(tester);
    expect(find.text('Chưa có BĐS nào.'), findsOneWidget);
  });

  testWidgets('lỗi tải trang đầu: hiện lỗi, thử lại được', (tester) async {
    var fail = true;
    repository = FakePropertiesRepository((page) async {
      if (fail) {
        throw _offline;
      }
      return pageOf([property(1)], total: 1);
    });
    await open(tester);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);

    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố số 1'), findsOneWidget);
  });

  testWidgets('lỗi tải trang sau: giữ danh sách, hiện thử lại ở cuối', (
    tester,
  ) async {
    var failPage2 = true;
    repository = FakePropertiesRepository((page) async {
      if (page == 2 && failPage2) {
        throw _offline;
      }
      return pageOf(
        [for (var i = 1; i <= 20; i++) property((page - 1) * 20 + i)],
        page: page,
        total: 40,
      );
    });
    await open(tester);
    await tester.scrollUntilVisible(
      find.text('Không kết nối được máy chủ'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Nhà phố số 20'), findsOneWidget);
    // Lỗi rồi thì cuộn tiếp không tự gọi lại, chỉ thử lại khi bấm.
    final calls = repository.listedPages.length;
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(repository.listedPages.length, calls);

    failPage2 = false;
    final retry = find.widgetWithText(TextButton, 'Thử lại');
    await tester.ensureVisible(retry);
    await tester.pumpAndSettle();
    await tester.tap(retry);
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Nhà phố số 40'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Nhà phố số 40'), findsOneWidget);
  });

  testWidgets('kéo xuống tải lại; lỗi thì giữ danh sách và báo snackbar', (
    tester,
  ) async {
    var calls = 0;
    repository = FakePropertiesRepository((page) async {
      calls++;
      if (calls == 3) {
        throw _offline;
      }
      return pageOf([property(calls)], total: 1);
    });
    await open(tester);
    expect(find.text('Nhà phố số 1'), findsOneWidget);

    await tester.fling(find.text('1 BĐS'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố số 2'), findsOneWidget);

    await tester.fling(find.text('1 BĐS'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố số 2'), findsOneWidget);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: không tràn', (tester) async {
    tester.view.physicalSize = const Size(960, 2400);
    tester.view.devicePixelRatio = 3;
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    repository = FakePropertiesRepository(
      (page) async =>
          pageOf([property(1, status: 'VERIFY_REQUIRED')], total: 1),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [propertiesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const PropertiesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố số 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('đang tải trang đầu: vòng chờ', (tester) async {
    final pending = Completer<void>();
    repository = FakePropertiesRepository((page) async {
      await pending.future;
      return pageOf(const [], total: 0);
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: [propertiesRepositoryProvider.overrideWithValue(repository)],
        child: const MaterialApp(home: PropertiesScreen()),
      ),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    pending.complete();
    await tester.pumpAndSettle();
  });
}
