import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';
import 'package:real_estate_os/features/auth/domain/current_user.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/locations/presentation/location_providers.dart';
import 'package:real_estate_os/features/properties/domain/property_draft.dart';
import 'package:real_estate_os/features/properties/domain/property_duplicates.dart';
import 'package:real_estate_os/features/properties/presentation/property_form.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_locations.dart';
import '../../support/fake_properties.dart';

const _creator = CurrentUser(
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Nguyễn Văn An',
  permissions: {'property.view': 'COMPANY', 'property.create': 'COMPANY'},
);

void main() {
  late FakePropertiesRepository repository;

  setUp(() => repository = FakePropertiesRepository());

  void tall(WidgetTester tester, {double width = 1200}) {
    tester.view.physicalSize = Size(width, 7200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  Finder field(String label) => find.widgetWithText(TextFormField, label);

  Future<void> choose(WidgetTester tester, String label, String item) async {
    final dropdown = find.widgetWithText(
      DropdownButtonFormField<String?>,
      label,
    );
    await tester.ensureVisible(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text(item).last);
    await tester.pumpAndSettle();
  }

  Future<void> save(WidgetTester tester) async {
    final button = find.widgetWithText(FilledButton, 'Lưu BĐS');
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  Future<void> fillRequired(WidgetTester tester) async {
    await tester.enterText(field('Tiêu đề *'), '  Nhà phố gần biển  ');
    await choose(tester, 'Loại BĐS *', 'Căn hộ');
    await tester.enterText(field('Giá (đồng) *'), '3500000000');
    await tester.enterText(field('Diện tích (m²) *'), '70,5');
    await choose(tester, 'Tỉnh/thành *', 'Khánh Hòa');
    await choose(tester, 'Phường/xã *', 'Vĩnh Hải');
  }

  /// Form đứng riêng (không qua router): lưu xong ghi lại kết quả.
  Future<List<String>> openForm(WidgetTester tester) async {
    tall(tester);
    final saved = <String>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          locationsRepositoryProvider.overrideWithValue(
            FakeLocationsRepository(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light,
          home: Scaffold(
            body: PropertyForm<({String id, String code})>(
              submitLabel: 'Lưu BĐS',
              submit: repository.create,
              onSaved: (created) => saved.add(created.code),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return saved;
  }

  testWidgets(
    'nhập đủ rồi lưu: gửi đúng dữ liệu, bỏ khoảng trắng, ô trống không gửi',
    (tester) async {
      final saved = await openForm(tester);
      await fillRequired(tester);
      expect(find.text('3.500.000.000'), findsOneWidget);
      expect(find.text('= 3,5 tỷ'), findsOneWidget);
      await tester.enterText(field('Số nhà, tên đường'), '12 Đường 2/4');
      await tester.enterText(field('Phòng ngủ'), '3');
      await tester.enterText(field('Đường rộng (m)'), '6.5');
      await choose(tester, 'Hướng nhà', 'Đông Nam');
      await choose(tester, 'Pháp lý', 'Sổ riêng');
      await save(tester);

      expect(saved, ['BDS-000099']);
      final [draft] = repository.created;
      expect(draft.toCreateJson(), {
        'title': 'Nhà phố gần biển',
        'propertyType': 'APARTMENT',
        'price': 3500000000,
        'area': 70.5,
        'bedrooms': 3,
        'direction': 'SE',
        'roadWidth': 6.5,
        'legalStatus': 'PRIVATE_BOOK',
        'provinceId': 'kh',
        'wardId': 'kh-vh',
        'streetAddress': '12 Đường 2/4',
      });
    },
  );

  testWidgets('thiếu trường bắt buộc: báo từng ô, không gọi API', (
    tester,
  ) async {
    await openForm(tester);
    await save(tester);
    for (final message in [
      'Vui lòng nhập tiêu đề',
      'Vui lòng chọn loại BĐS',
      'Vui lòng nhập giá',
      'Vui lòng nhập diện tích',
      'Vui lòng chọn tỉnh/thành',
      'Vui lòng kiểm tra lại các ô báo lỗi.',
    ]) {
      expect(find.text(message), findsOneWidget, reason: message);
    }
    expect(repository.created, isEmpty);
  });

  testWidgets('số sai: diện tích 0, 3 số lẻ, số phòng quá lớn', (tester) async {
    await openForm(tester);
    await tester.enterText(field('Diện tích (m²) *'), '0');
    await tester.enterText(field('Đường rộng (m)'), '1,234');
    await tester.enterText(field('Số tầng'), '40000');
    await save(tester);
    expect(find.text('Phải lớn hơn 0'), findsOneWidget);
    expect(find.text('Nhập số, tối đa 2 chữ số sau dấu phẩy'), findsOneWidget);
    expect(find.text('Tối đa 32.767'), findsOneWidget);
  });

  testWidgets('API báo lỗi trường: hiện dưới ô đó, sửa ô thì mất lỗi', (
    tester,
  ) async {
    repository.onCreate = (draft) async => throw const ApiException(
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu không hợp lệ',
      statusCode: 400,
      details: [FieldError(field: 'title', message: 'title chứa HTML')],
    );
    final saved = await openForm(tester);
    await fillRequired(tester);
    await save(tester);
    expect(saved, isEmpty);
    expect(find.text('title chứa HTML'), findsOneWidget);
    expect(find.text('Dữ liệu không hợp lệ'), findsOneWidget);

    await tester.ensureVisible(field('Tiêu đề *'));
    await tester.enterText(field('Tiêu đề *'), 'Nhà phố');
    await tester.pump();
    expect(find.text('title chứa HTML'), findsNothing);
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await openForm(tester);
    tester.view.physicalSize = const Size(960, 7200);
    await tester.pumpAndSettle();
    await fillRequired(tester);
    await save(tester);
    expect(tester.takeException(), isNull);
  });

  group('qua app', () {
    Future<void> openApp(WidgetTester tester, CurrentUser user) async {
      tall(tester);
      repository.onList = (page) async => pageOf([property(1)], total: 1);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authRepositoryProvider.overrideWithValue(
              FakeAuthRepository(() async => user),
            ),
            propertiesRepositoryProvider.overrideWithValue(repository),
            locationsRepositoryProvider.overrideWithValue(
              FakeLocationsRepository(),
            ),
          ],
          child: const App(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text('BĐS'),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('không có quyền tạo thì không có nút "Thêm BĐS"', (
      tester,
    ) async {
      await openApp(tester, testUser);
      expect(find.text('Nhà phố số 1'), findsOneWidget);
      expect(find.text('Thêm BĐS'), findsNothing);
    });

    testWidgets('thêm BĐS xong mở chi tiết, quay lại danh sách đã tải lại', (
      tester,
    ) async {
      await openApp(tester, _creator);
      await tester.tap(find.text('Thêm BĐS'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(AppBar, 'Thêm BĐS'), findsOneWidget);

      await fillRequired(tester);
      await save(tester);
      expect(find.text('Đã thêm BĐS BDS-000099.'), findsOneWidget);
      expect(repository.duplicateChecks, hasLength(1));
      expect(repository.detailCalls, ['new-id']);

      final listCalls = repository.listedPages.length;
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('Nhà phố số 1'), findsOneWidget);
      expect(repository.listedPages.length, listCalls + 1);
    });

    testWidgets(
      'nghi trùng: hỏi lại; "Xem lại" không lưu, "Vẫn lưu" thì lưu (TASK-144)',
      (tester) async {
        repository.onDuplicateCheck = (draft) async => const DuplicateReport(
          threshold: 70,
          matches: [
            DuplicateMatch(
              code: 'BDS-000125',
              similarity: 87,
              reasons: ['Cùng phường/xã', 'Giá lệch 2%'],
              propertyId: 'p125',
              title: 'Căn hộ Vĩnh Hải',
            ),
            DuplicateMatch(code: 'BDS-000130', similarity: 72),
          ],
        );
        await openApp(tester, _creator);
        await tester.tap(find.text('Thêm BĐS'));
        await tester.pumpAndSettle();
        await fillRequired(tester);
        await save(tester);

        expect(repository.duplicateChecks.single.title, 'Nhà phố gần biển');
        expect(find.text('Có thể trùng BĐS đã có'), findsOneWidget);
        expect(find.text('BĐS này giống từ 70% trở lên với:'), findsOneWidget);
        expect(find.text('BDS-000125 · giống 87%'), findsOneWidget);
        expect(find.text('Căn hộ Vĩnh Hải'), findsOneWidget);
        expect(find.text('Cùng phường/xã, Giá lệch 2%'), findsOneWidget);
        expect(find.text('BDS-000130 · giống 72%'), findsOneWidget);

        await tester.tap(find.text('Xem lại'));
        await tester.pumpAndSettle();
        expect(repository.created, isEmpty);
        expect(find.widgetWithText(AppBar, 'Thêm BĐS'), findsOneWidget);

        await save(tester);
        await tester.tap(find.text('Vẫn lưu'));
        await tester.pumpAndSettle();
        expect(repository.duplicateChecks, hasLength(2));
        expect(repository.created, hasLength(1));
        expect(find.text('Đã thêm BĐS BDS-000099.'), findsOneWidget);
      },
    );

    testWidgets('kiểm trùng lỗi thì vẫn lưu, không hỏi', (tester) async {
      repository.onDuplicateCheck = (draft) async =>
          throw const ApiException(code: 'INTERNAL_ERROR', message: 'Lỗi');
      await openApp(tester, _creator);
      await tester.tap(find.text('Thêm BĐS'));
      await tester.pumpAndSettle();
      await fillRequired(tester);
      await save(tester);
      expect(find.text('Có thể trùng BĐS đã có'), findsNothing);
      expect(repository.created, hasLength(1));
    });

    testWidgets('đã nhập mà bấm quay lại: hỏi trước khi bỏ', (tester) async {
      await openApp(tester, _creator);
      await tester.tap(find.text('Thêm BĐS'));
      await tester.pumpAndSettle();
      await tester.enterText(field('Tiêu đề *'), 'Nháp');
      await tester.pump();

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('Bỏ thay đổi?'), findsOneWidget);
      await tester.tap(find.text('Ở lại'));
      await tester.pumpAndSettle();
      expect(find.text('Nháp'), findsOneWidget);

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Bỏ'));
      await tester.pumpAndSettle();
      expect(find.text('Nhà phố số 1'), findsOneWidget);
      expect(repository.created, isEmpty);
    });

    testWidgets('chưa nhập gì thì quay lại ngay', (tester) async {
      await openApp(tester, _creator);
      await tester.tap(find.text('Thêm BĐS'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('Bỏ thay đổi?'), findsNothing);
      expect(find.text('Nhà phố số 1'), findsOneWidget);
    });
  });

  test('PropertyDraft.toCreateJson bỏ trường trống', () {
    const draft = PropertyDraft(
      title: 'A',
      propertyType: 'LAND',
      price: 0,
      area: 100,
      provinceId: 'p',
      wardId: 'w',
    );
    expect(draft.toCreateJson(), {
      'title': 'A',
      'propertyType': 'LAND',
      'price': 0,
      'area': 100.0,
      'provinceId': 'p',
      'wardId': 'w',
    });
  });
}
