import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/properties/presentation/properties_screen.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';
import 'package:real_estate_os/features/properties/presentation/property_search_field.dart';

import '../../support/fake_properties.dart';

final _list = find.descendant(
  of: find.byType(ListView),
  matching: find.byType(Scrollable),
);

void main() {
  late FakePropertiesRepository repository;

  String keyword() => repository.listedQueries.last.keyword;

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

  /// Toàn bộ BĐS 1..5; có từ khoá thì chỉ BĐS có số trùng từ khoá ("3" → BĐS 3).
  Future<void> openWithCatalog(WidgetTester tester) {
    repository = FakePropertiesRepository((page) async {
      final q = keyword();
      final items = [
        for (var i = 1; i <= 5; i++)
          if (q.isEmpty || '$i' == q) property(i),
      ];
      return pageOf(items, total: items.length);
    });
    return open(tester);
  }

  testWidgets('gõ xong mới tìm (chờ debounce), bỏ khoảng trắng thừa', (
    tester,
  ) async {
    repository = FakePropertiesRepository(
      (page) async => keyword().isEmpty
          ? pageOf([property(1), property(2)], total: 2)
          : pageOf([property(7)], total: 1),
    );
    await open(tester);
    expect(find.text('2 BĐS'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '  vinh   hai ');
    await tester.pump(const Duration(milliseconds: 300));
    expect(repository.listedQueries, hasLength(1));

    await tester.pump(PropertySearchField.debounce);
    await tester.pumpAndSettle();
    expect(repository.listedQueries, hasLength(2));
    expect(keyword(), 'vinh hai');
    expect(repository.listedPages.last, 1);
    expect(find.text('1 kết quả'), findsOneWidget);
    expect(find.text('Nhà phố số 7'), findsOneWidget);
    expect(find.text('Nhà phố số 1'), findsNothing);
  });

  testWidgets('bấm tìm trên bàn phím thì tìm ngay', (tester) async {
    await openWithCatalog(tester);
    await tester.enterText(find.byType(TextField), '3');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(keyword(), '3');
    expect(find.text('Nhà phố số 3'), findsOneWidget);
    // Hết thời gian chờ không gọi lại lần nữa.
    await tester.pump(PropertySearchField.debounce);
    await tester.pumpAndSettle();
    expect(repository.listedQueries, hasLength(2));
  });

  testWidgets('không có kết quả: báo kèm từ khoá; xoá thì về danh sách đủ', (
    tester,
  ) async {
    await openWithCatalog(tester);
    await tester.enterText(find.byType(TextField), '99');
    await tester.pump(PropertySearchField.debounce);
    await tester.pumpAndSettle();
    expect(find.text('Không tìm thấy BĐS khớp "99".'), findsOneWidget);

    await tester.tap(find.byTooltip('Xoá tìm kiếm'));
    await tester.pumpAndSettle();
    expect(keyword(), '');
    expect(find.text('5 BĐS'), findsOneWidget);
    expect(find.byTooltip('Xoá tìm kiếm'), findsNothing);
  });

  testWidgets('chỉ thêm khoảng trắng thì không tìm lại', (tester) async {
    await openWithCatalog(tester);
    await tester.enterText(find.byType(TextField), '3');
    await tester.pump(PropertySearchField.debounce);
    await tester.pumpAndSettle();
    final calls = repository.listedQueries.length;

    await tester.enterText(find.byType(TextField), ' 3  ');
    await tester.pump(PropertySearchField.debounce);
    await tester.pumpAndSettle();
    expect(repository.listedQueries, hasLength(calls));
  });

  testWidgets('đổi từ khoá khi đang tải thêm: bỏ trang cũ về muộn', (
    tester,
  ) async {
    final slowPage2 = Completer<void>();
    repository = FakePropertiesRepository((page) async {
      if (keyword().isNotEmpty) {
        return pageOf([property(99)], total: 1);
      }
      if (page == 2) {
        await slowPage2.future;
      }
      return pageOf(
        [for (var i = 1; i <= 20; i++) property((page - 1) * 20 + i)],
        page: page,
        total: 40,
      );
    });
    await open(tester);
    await tester.drag(_list, const Offset(0, -8000));
    await tester.pump();
    expect(repository.listedPages, [1, 2]);

    await tester.enterText(find.byType(TextField), 'abc');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('Nhà phố số 99'), findsOneWidget);

    slowPage2.complete();
    await tester.pumpAndSettle();
    expect(find.text('1 kết quả'), findsOneWidget);
    expect(find.text('Nhà phố số 21'), findsNothing);
    expect(find.text('Nhà phố số 99'), findsOneWidget);
  });
}
