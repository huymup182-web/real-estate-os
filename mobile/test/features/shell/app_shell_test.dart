import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/providers.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';

void main() {
  Widget app() => ProviderScope(
    overrides: [tokenStorageProvider.overrideWithValue(MemoryTokenStorage())],
    child: const App(),
  );

  testWidgets('mở app vào tab Trang chủ, có đủ 5 tab dưới', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationDestination), findsNWidgets(5));
    expect(find.widgetWithText(AppBar, 'Trang chủ'), findsOneWidget);
  });

  testWidgets('bấm tab chuyển màn hình', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    for (final (tab, title) in [
      ('BĐS', 'Bất động sản'),
      ('Khách hàng', 'Khách hàng'),
      ('Thông báo', 'Thông báo'),
      ('Tài khoản', 'Tài khoản'),
      ('Trang chủ', 'Trang chủ'),
    ]) {
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text(tab),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.widgetWithText(AppBar, title), findsOneWidget, reason: tab);
    }
  });
}
