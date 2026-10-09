import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:real_estate_os/app.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/router/app_router.dart';
import 'package:real_estate_os/features/auth/presentation/session_controller.dart';
import 'package:real_estate_os/features/properties/domain/picked_image.dart';
import 'package:real_estate_os/features/properties/domain/property_detail.dart';
import 'package:real_estate_os/features/properties/presentation/property_images_controller.dart';
import 'package:real_estate_os/features/properties/presentation/property_list_controller.dart';

import '../../support/fake_auth.dart';
import '../../support/fake_properties.dart';
import '../../support/fake_property_images.dart';

const _offline = ApiException(
  code: ErrorCodes.networkError,
  message: 'Không kết nối được nơi lưu ảnh, vui lòng thử lại',
);

void main() {
  late FakePropertiesRepository properties;
  late FakePropertyImagesRepository images;
  late List<PropertyImage> stored;
  late List<({PickSource source, int limit})> picks;
  late Future<List<PickedImage>> Function() onPick;

  setUp(() {
    stored = [storedImage(1, isCover: true), storedImage(2)];
    properties = FakePropertiesRepository()
      ..onImages = (id) async => List.of(stored);
    images = FakePropertyImagesRepository();
    picks = [];
    onPick = () async => [pickedImage('a.jpg')];
  });

  /// Mở app vào chi tiết BĐS p1 rồi bấm "Quản lý ảnh".
  Future<void> open(
    WidgetTester tester, {
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
          propertiesRepositoryProvider.overrideWithValue(properties),
          propertyImagesRepositoryProvider.overrideWithValue(images),
          imagePickerProvider.overrideWithValue((source, limit) {
            picks.add((source: source, limit: limit));
            return onPick();
          }),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    GoRouter.of(tester.element(find.byType(NavigationBar)))
        .go(AppRoutes.propertyDetail('p1'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Quản lý ảnh'));
    await tester.pumpAndSettle();
  }

  /// Như pumpAndSettle nhưng không chờ vòng xoay của ảnh đang tải (quay mãi).
  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
  }

  Future<void> pick(WidgetTester tester, String source) async {
    await tester.tap(find.text('Thêm ảnh'));
    await settle(tester);
    await tester.tap(find.text(source));
    await settle(tester);
  }

  Future<void> choose(WidgetTester tester, String action) async {
    await tester.tap(find.text(action));
    await settle(tester);
  }

  testWidgets('không được sửa BĐS thì không có nút quản lý ảnh', (
    tester,
  ) async {
    properties.onDetail = (id) async => propertyDetail(id, canEdit: false);
    tester.view.physicalSize = const Size(1200, 4000);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            FakeAuthRepository(() async => testUser),
          ),
          propertiesRepositoryProvider.overrideWithValue(properties),
        ],
        child: const App(),
      ),
    );
    await tester.pumpAndSettle();
    GoRouter.of(tester.element(find.byType(NavigationBar)))
        .go(AppRoutes.propertyDetail('p1'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'BDS-000001'), findsOneWidget);
    expect(find.byTooltip('Quản lý ảnh'), findsNothing);
  });

  testWidgets('chọn ảnh từ thư viện: tải lên, xong thì hiện trong lưới', (
    tester,
  ) async {
    await open(tester);
    expect(find.widgetWithText(AppBar, 'Ảnh BĐS'), findsOneWidget);
    expect(
      find.text('2/30 ảnh · Chạm ảnh để đặt làm ảnh bìa hoặc xoá.'),
      findsOneWidget,
    );
    expect(find.text('Ảnh bìa'), findsOneWidget);

    final done = Completer<PropertyImage>();
    images.onUpload = (image, onProgress) {
      onProgress?.call(0.4);
      return done.future;
    };
    onPick = () async => [pickedImage('a.jpg'), pickedImage('b.png')];
    await pick(tester, 'Chọn từ thư viện');

    // Còn 28 chỗ; ảnh đầu đang tải (40%), ảnh sau chờ.
    expect(picks.single, (source: PickSource.gallery, limit: 28));
    expect(images.uploaded.map((u) => u.name), ['a.jpg']);
    expect(
      find.text('4/30 ảnh · Chạm ảnh để đặt làm ảnh bìa hoặc xoá.'),
      findsOneWidget,
    );
    final progress = tester
        .widgetList<CircularProgressIndicator>(
          find.byType(CircularProgressIndicator),
        )
        .map((indicator) => indicator.value);
    expect(progress, containsAll([0.4, null]));

    stored = [...stored, storedImage(3)];
    images.onUpload = (image, onProgress) async {
      stored = [...stored, storedImage(4)];
      return storedImage(4);
    };
    done.complete(storedImage(3));
    await tester.pumpAndSettle();

    expect(images.uploaded.map((u) => u.name), ['a.jpg', 'b.png']);
    expect(images.uploaded.every((u) => u.propertyId == 'p1'), isTrue);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(
      find.text('4/30 ảnh · Chạm ảnh để đặt làm ảnh bìa hoặc xoá.'),
      findsOneWidget,
    );
  });

  testWidgets('chụp ảnh: gọi máy ảnh', (tester) async {
    await open(tester);
    await pick(tester, 'Chụp ảnh');
    expect(picks.single.source, PickSource.camera);
    expect(images.uploaded, hasLength(1));
  });

  testWidgets('tải lỗi: giữ ảnh ở trạng thái lỗi, thử lại được', (
    tester,
  ) async {
    await open(tester);
    var fail = true;
    images.onUpload = (image, onProgress) async {
      if (fail) {
        throw _offline;
      }
      stored = [...stored, storedImage(3)];
      return storedImage(3);
    };
    await pick(tester, 'Chọn từ thư viện');
    expect(find.byIcon(Icons.error_outline), findsOneWidget);

    await tester.tap(find.byIcon(Icons.error_outline));
    await tester.pumpAndSettle();
    expect(find.text(_offline.message), findsOneWidget);
    fail = false;
    await choose(tester, 'Thử lại');
    expect(find.byIcon(Icons.error_outline), findsNothing);
    expect(images.uploaded, hasLength(2));
    expect(
      find.text('3/30 ảnh · Chạm ảnh để đặt làm ảnh bìa hoặc xoá.'),
      findsOneWidget,
    );
  });

  testWidgets('ảnh sai định dạng hoặc quá 10MB: không gửi, bỏ được', (
    tester,
  ) async {
    await open(tester);
    onPick = () async => [
      pickedImage('a.gif'),
      pickedImage('big.jpg', sizeBytes: maxImageBytes + 1),
    ];
    await pick(tester, 'Chọn từ thư viện');
    expect(images.uploaded, isEmpty);
    expect(find.byIcon(Icons.error_outline), findsNWidgets(2));

    await tester.tap(find.byIcon(Icons.error_outline).first);
    await tester.pumpAndSettle();
    expect(find.text('Chỉ nhận ảnh JPG, PNG, WEBP, HEIC'), findsOneWidget);
    expect(find.text('Thử lại'), findsNothing);
    await choose(tester, 'Bỏ ảnh này');
    await tester.tap(find.byIcon(Icons.error_outline));
    await tester.pumpAndSettle();
    expect(find.text('Ảnh quá 10MB'), findsOneWidget);
    await choose(tester, 'Bỏ ảnh này');
    expect(find.byIcon(Icons.error_outline), findsNothing);
  });

  testWidgets('đặt ảnh bìa', (tester) async {
    await open(tester);
    images.onSetCover = (imageId) async =>
        stored = [storedImage(1), storedImage(2, isCover: true)];
    await tester.tap(find.byType(InkWell).at(1));
    await tester.pumpAndSettle();
    await choose(tester, 'Đặt làm ảnh bìa');
    expect(images.covers, ['img2']);
    expect(find.text('Đã đặt ảnh bìa.'), findsOneWidget);

    // Ảnh đang là bìa thì không có "Đặt làm ảnh bìa".
    await tester.tap(find.byType(InkWell).at(1));
    await tester.pumpAndSettle();
    expect(find.text('Đặt làm ảnh bìa'), findsNothing);
    expect(find.text('Xoá ảnh'), findsOneWidget);
  });

  testWidgets('xoá ảnh: hỏi lại; huỷ thì không xoá', (tester) async {
    await open(tester);
    images.onDelete = (imageId) async => stored = [storedImage(2)];
    await tester.tap(find.byType(InkWell).first);
    await tester.pumpAndSettle();
    await choose(tester, 'Xoá ảnh');
    expect(
      find.text('Đây là ảnh bìa; ảnh đầu tiên còn lại sẽ thành ảnh bìa.'),
      findsOneWidget,
    );
    await choose(tester, 'Huỷ');
    expect(images.deleted, isEmpty);

    await tester.tap(find.byType(InkWell).first);
    await tester.pumpAndSettle();
    await choose(tester, 'Xoá ảnh');
    await choose(tester, 'Xoá');
    expect(images.deleted, ['img1']);
    expect(find.text('Đã xoá ảnh.'), findsOneWidget);
    expect(
      find.text('1/30 ảnh · Chạm ảnh để đặt làm ảnh bìa hoặc xoá.'),
      findsOneWidget,
    );
  });

  testWidgets('xoá lỗi: báo snackbar, giữ ảnh', (tester) async {
    await open(tester);
    images.onDelete = (imageId) async => throw const ApiException(
      code: ErrorCodes.forbidden,
      message: 'Bạn không có quyền sửa BĐS này',
      statusCode: 403,
    );
    await tester.tap(find.byType(InkWell).at(1));
    await tester.pumpAndSettle();
    await choose(tester, 'Xoá ảnh');
    await choose(tester, 'Xoá');
    expect(find.text('Bạn không có quyền sửa BĐS này'), findsOneWidget);
    expect(
      find.text('2/30 ảnh · Chạm ảnh để đặt làm ảnh bìa hoặc xoá.'),
      findsOneWidget,
    );
  });

  testWidgets('đủ 30 ảnh: nút thêm ảnh bị tắt', (tester) async {
    stored = [for (var i = 1; i <= 30; i++) storedImage(i, isCover: i == 1)];
    await open(tester);
    final button = tester.widget<FloatingActionButton>(
      find.byType(FloatingActionButton),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('không mở được trình chọn ảnh: nhắc cấp quyền', (tester) async {
    await open(tester);
    onPick = () async => throw Exception('denied');
    await pick(tester, 'Chọn từ thư viện');
    expect(
      find.text(
        'Không mở được ảnh. Hãy cho app quyền truy cập ảnh/máy ảnh trong Cài đặt.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('chưa có ảnh: hướng dẫn thêm', (tester) async {
    stored = [];
    await open(tester);
    expect(
      find.text('Chưa có ảnh. Bấm "Thêm ảnh" để chọn từ thư viện hoặc chụp.'),
      findsOneWidget,
    );
  });

  testWidgets('đang tải mà quay lại: hỏi; ở lại thì vẫn tải tiếp', (
    tester,
  ) async {
    await open(tester);
    final done = Completer<PropertyImage>();
    images.onUpload = (image, onProgress) => done.future;
    await pick(tester, 'Chọn từ thư viện');

    await tester.tap(find.byType(BackButton));
    await settle(tester);
    expect(find.text('Dừng tải ảnh?'), findsOneWidget);
    await choose(tester, 'Huỷ');
    expect(find.widgetWithText(AppBar, 'Ảnh BĐS'), findsOneWidget);

    await tester.tap(find.byType(BackButton));
    await settle(tester);
    await choose(tester, 'Rời đi');
    expect(find.widgetWithText(AppBar, 'BDS-000001'), findsOneWidget);
    done.complete(storedImage(3));
    await tester.pumpAndSettle();
  });

  testWidgets('màn hẹp 320px, chữ to 1.3: không tràn', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, size: const Size(960, 2000));
    images.onUpload = (image, onProgress) => Completer<PropertyImage>().future;
    await pick(tester, 'Chọn từ thư viện');
    await tester.tap(find.byType(InkWell).first);
    await settle(tester);
    expect(find.text('Xoá ảnh'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
