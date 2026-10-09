import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_properties.dart';

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được máy chủ',
);

void main() {
  late FakePropertiesRepository repository;

  setUp(() {
    repository = FakePropertiesRepository(
      (page) async =>
          pageOf([property(1), property(2, isFavorite: true)], total: 2),
    );
  });

  /// Mở app ở [location] (mặc định tab BĐS).
  Future<void> open(
    WidgetTester tester, {
    String location = AppRoutes.properties,
    Size size = const Size(1200, 4000),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => testUser),
          ),
          propertiesRepositoryProvider.overrideWithValue(repository),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    GoRouter.of(tester.element(find.byType(NavigationBar))).go(location);
    await tester.pumpAndSettle();
  }

  Finder heartOf(String title) => find.descendant(
    of: find.ancestor(of: find.text(title), matching: find.byType(Card)),
    matching: find.byType(IconButton),
  );

  String tooltipOf(WidgetTester tester, Finder button) =>
      tester.widget<IconButton>(button).tooltip!;

  testWidgets('thẻ BĐS: tim theo API, bấm thì lưu/bỏ ngay', (tester) async {
    await open(tester);
    expect(tooltipOf(tester, heartOf('Nhà phố số 1')), 'Lưu yêu thích');
    expect(tooltipOf(tester, heartOf('Nhà phố số 2')), 'Bỏ yêu thích');

    await tester.tap(heartOf('Nhà phố số 1'));
    await tester.pumpAndSettle();
    await tester.tap(heartOf('Nhà phố số 2'));
    await tester.pumpAndSettle();
    expect(repository.favoriteCalls, [
      (id: 'p1', favorite: true),
      (id: 'p2', favorite: false),
    ]);
    expect(tooltipOf(tester, heartOf('Nhà phố số 1')), 'Bỏ yêu thích');
    expect(tooltipOf(tester, heartOf('Nhà phố số 2')), 'Lưu yêu thích');
    // Không tải lại cả danh sách.
    expect(repository.listedPages, [1]);
  });

  testWidgets('lỗi: trả tim như cũ, báo snackbar', (tester) async {
    repository.onSetFavorite = (id, favorite) async => throw _offline;
    await open(tester);
    await tester.tap(heartOf('Nhà phố số 1'));
    await tester.pumpAndSettle();
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    expect(tooltipOf(tester, heartOf('Nhà phố số 1')), 'Lưu yêu thích');
  });

  testWidgets('đang gửi thì bấm thêm không gửi lại', (tester) async {
    final pending = Completer<void>();
    repository.onSetFavorite = (id, favorite) => pending.future;
    await open(tester);
    await tester.tap(heartOf('Nhà phố số 1'));
    await tester.pump();
    await tester.tap(heartOf('Nhà phố số 1'));
    await tester.pump();
    expect(repository.favoriteCalls, hasLength(1));
    pending.complete();
    await tester.pumpAndSettle();
    expect(tooltipOf(tester, heartOf('Nhà phố số 1')), 'Bỏ yêu thích');
  });

  testWidgets('chi tiết: lưu ở chi tiết thì thẻ trong danh sách cũng đổi', (
    tester,
  ) async {
    await open(tester);
    await tester.tap(find.text('Nhà phố số 1'));
    await tester.pumpAndSettle();
    final appBarHeart = find.descendant(
      of: find.byType(AppBar),
      matching: find.byTooltip('Lưu yêu thích'),
    );
    expect(appBarHeart, findsOneWidget);
    await tester.tap(appBarHeart);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byType(AppBar),
        matching: find.byTooltip('Bỏ yêu thích'),
      ),
      findsOneWidget,
    );

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(tooltipOf(tester, heartOf('Nhà phố số 1')), 'Bỏ yêu thích');
  });

  testWidgets(
    'danh sách yêu thích: mở từ tab BĐS; bỏ tim thì ẩn, hoàn tác thì hiện lại',
    (tester) async {
      var saved = [
        property(3, isFavorite: true),
        property(4, isFavorite: true),
      ];
      repository
        ..onFavorites = ((page) async => pageOf(saved, total: saved.length))
        ..onSetFavorite = (id, favorite) async {
          saved = favorite
              ? [property(3, isFavorite: true), property(4, isFavorite: true)]
              : [property(4, isFavorite: true)];
        };
      await open(tester);
      await tester.tap(find.byTooltip('BĐS yêu thích'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(AppBar, 'BĐS yêu thích'), findsOneWidget);
      expect(find.text('2 BĐS'), findsOneWidget);
      expect(find.text('Nhà phố số 3'), findsOneWidget);

      await tester.tap(heartOf('Nhà phố số 3'));
      await tester.pumpAndSettle();
      expect(find.text('Nhà phố số 3'), findsNothing);
      expect(find.text('1 BĐS'), findsOneWidget);
      expect(find.text('Đã bỏ khỏi yêu thích.'), findsOneWidget);

      await tester.tap(find.text('Hoàn tác'));
      await tester.pumpAndSettle();
      expect(repository.favoriteCalls, [
        (id: 'p3', favorite: false),
        (id: 'p3', favorite: true),
      ]);
      expect(find.text('Nhà phố số 3'), findsOneWidget);
      expect(find.text('2 BĐS'), findsOneWidget);

      // Chạm thẻ mở chi tiết.
      await tester.tap(find.text('Nhà phố số 4'));
      await tester.pumpAndSettle();
      expect(repository.detailCalls, ['p4']);
    },
  );

  testWidgets('chưa có BĐS yêu thích: hướng dẫn', (tester) async {
    await open(tester, location: AppRoutes.propertyFavorites);
    expect(
      find.text(
        'Chưa có BĐS yêu thích. Bấm biểu tượng tim trên BĐS để lưu lại xem sau.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('nhiều trang: cuộn tới cuối thì tải thêm', (tester) async {
    repository.onFavorites = (page) async => pageOf(
      [
        for (var i = 1; i <= 20; i++)
          property((page - 1) * 20 + i, isFavorite: true),
      ],
      page: page,
      total: 40,
    );
    await open(tester, location: AppRoutes.propertyFavorites);
    await tester.scrollUntilVisible(
      find.text('Nhà phố số 40'),
      500,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    expect(repository.favoritePages, [1, 2]);
  });

  testWidgets('lỗi tải: thử lại được', (tester) async {
    var fail = true;
    repository.onFavorites = (page) async {
      if (fail) {
        throw _offline;
      }
      return pageOf([property(5, isFavorite: true)], total: 1);
    };
    await open(tester, location: AppRoutes.propertyFavorites);
    expect(find.text('Không kết nối được máy chủ'), findsOneWidget);
    fail = false;
    await tester.tap(find.widgetWithText(TextButton, 'Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố số 5'), findsOneWidget);
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    repository
      ..onFavorites = ((page) async =>
          pageOf([property(1, isFavorite: true)], total: 1))
      ..onDetail = (id) async => propertyDetail(id, isFavorite: true);
    await open(
      tester,
      location: AppRoutes.propertyFavorites,
      size: const Size(960, 2000),
    );
    expect(find.text('Nhà phố số 1'), findsOneWidget);
    await tester.tap(find.text('Nhà phố số 1'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Bỏ yêu thích'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
