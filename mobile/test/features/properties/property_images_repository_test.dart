import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/api_exception.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/properties/data/property_images_repository.dart';
import 'package:real_estate_os/features/properties/domain/picked_image.dart';

import '../../support/fake_adapter.dart';

void main() {
  late FakeAdapter api;
  late FakeAdapter storage;
  late PropertyImagesRepository repository;
  var storageStatus = 200;

  final image = PickedImage(
    name: 'a.jpg',
    bytes: Uint8List.fromList([1, 2, 3, 4, 5]),
    mimeType: 'image/jpeg',
  );

  Map<String, Object?> ok(Object? data) => {
    'success': true,
    'message': null,
    'data': data,
  };

  setUp(() {
    storageStatus = 200;
    final tokens = MemoryTokenStorage(
      const AuthTokens(accessToken: 'access', refreshToken: 'refresh'),
    );
    api = FakeAdapter(
      (options) => switch ((options.method, options.path)) {
        ('POST', final path) when path.endsWith('/images/upload-url') => (
          201,
          ok({
            'imageId': 'img9',
            'uploadUrl': 'https://storage.example/bucket/key?sig=1',
            'headers': {'Content-Type': 'image/jpeg'},
            'expiresAt': '2026-10-09T03:00:00.000Z',
          }),
        ),
        ('POST', final path) when path.endsWith('/images') => (
          201,
          ok({
            'id': 'img9',
            'url': 'https://cdn/9.jpg',
            'thumbnailUrl': null,
            'isCover': true,
          }),
        ),
        ('POST', _) => (200, ok(const [])),
        _ => (204, null),
      },
    );
    storage = FakeAdapter((options) => (storageStatus, null));
    repository = PropertyImagesRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: tokens,
        dio: Dio()..httpClientAdapter = api,
      ),
      Dio()..httpClientAdapter = storage,
    );
  });

  test('tải lên 3 bước: xin link, PUT file lên storage, xác nhận', () async {
    final saved = await repository.upload('p1', image);

    expect(api.requests, hasLength(2));
    final ticket = api.requests.first;
    expect(ticket.options.uri.path, '/api/v1/properties/p1/images/upload-url');
    expect(ticket.body, {'mimeType': 'image/jpeg', 'sizeBytes': 5});

    expect(storage.requests, hasLength(1));
    final put = storage.requests.single.options;
    expect(put.method, 'PUT');
    expect(put.uri.toString(), 'https://storage.example/bucket/key?sig=1');
    expect(put.headers['Content-Type'], 'image/jpeg');
    expect(put.headers[Headers.contentLengthHeader], 5);
    // Link đã ký: không gửi token của app sang storage.
    expect(put.headers['Authorization'], isNull);

    final confirm = api.requests.last;
    expect(confirm.options.uri.path, '/api/v1/properties/p1/images');
    expect(confirm.body, {'imageId': 'img9', 'mimeType': 'image/jpeg'});
    expect(saved.id, 'img9');
    expect(saved.isCover, isTrue);
  });

  test('storage từ chối: báo lỗi, không xác nhận', () async {
    storageStatus = 403;
    await expectLater(
      repository.upload('p1', image),
      throwsA(
        isA<ApiException>()
            .having((e) => e.statusCode, 'statusCode', 403)
            .having(
              (e) => e.message,
              'message',
              'Tải ảnh lên không thành công, vui lòng thử lại',
            ),
      ),
    );
    expect(api.requests, hasLength(1));
  });

  test('mất mạng khi PUT: lỗi mạng', () async {
    storage.offline = true;
    await expectLater(
      repository.upload('p1', image),
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          ErrorCodes.networkError,
        ),
      ),
    );
  });

  test('đặt ảnh bìa, xoá ảnh', () async {
    await repository.setCover('p1', 'img2');
    await repository.delete('p1', 'img3');
    expect(
      [
        for (final r in api.requests)
          '${r.options.method} ${r.options.uri.path}',
      ],
      [
        'POST /api/v1/properties/p1/images/img2/cover',
        'DELETE /api/v1/properties/p1/images/img3',
      ],
    );
  });
}
