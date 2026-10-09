import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/properties/data/properties_repository.dart';
import 'package:real_estate_os/features/properties/domain/property_draft.dart';
import 'package:real_estate_os/features/properties/domain/property_query.dart';

import '../../support/fake_adapter.dart';

void main() {
  test('GET /properties theo trang, đọc thẻ BĐS và meta', () async {
    final adapter = FakeAdapter(
      (options) => (
        200,
        {
          'success': true,
          'message': null,
          'data': [
            {
              'id': 'p1',
              'code': 'BDS-000001',
              'title': 'Nhà phố',
              'propertyType': 'HOUSE',
              'price': 3500000000,
              'area': 70,
              'bedrooms': null,
              'bathrooms': 2,
              'status': 'AVAILABLE',
              'provinceName': 'Khánh Hòa',
              'wardName': 'Vĩnh Hải',
              'isFavorite': true,
              'coverImage': {
                'url': 'https://cdn/a.jpg',
                'thumbnailUrl': 'https://cdn/a_thumb.webp',
              },
            },
            {
              'id': 'p2',
              'code': 'BDS-000002',
              'title': 'Đất nền',
              'propertyType': 'LAND_PLOT',
              'price': 900000000,
              'area': 100.25,
              'status': 'PENDING',
              'provinceName': 'Khánh Hòa',
              'wardName': '',
              'coverImage': {'url': 'https://cdn/b.jpg', 'thumbnailUrl': null},
            },
          ],
          'meta': {'page': 2, 'pageSize': 20, 'total': 22, 'totalPages': 2},
        },
      ),
    );
    final repository = PropertiesRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );

    final page = await repository.list(page: 2);
    final request = adapter.requests.single.options;
    expect(request.path, '/properties');
    expect(request.queryParameters, {'page': 2, 'pageSize': 20});
    expect(page.meta.total, 22);
    expect(page.meta.hasNext, isFalse);
    final [first, second] = page.items;
    expect(first.coverUrl, 'https://cdn/a_thumb.webp');
    expect(first.isFavorite, isTrue);
    expect(first.bedrooms, isNull);
    expect(first.location, 'Vĩnh Hải, Khánh Hòa');
    expect(second.coverUrl, 'https://cdn/b.jpg');
    expect(second.area, 100.25);
    expect(second.location, 'Khánh Hòa');
  });

  test('có từ khoá thì gửi q, không có thì không gửi', () async {
    final adapter = FakeAdapter(
      (options) => (
        200,
        {
          'success': true,
          'message': null,
          'data': <Object>[],
          'meta': {'page': 1, 'pageSize': 20, 'total': 0, 'totalPages': 0},
        },
      ),
    );
    final repository = PropertiesRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );

    await repository.list(
      page: 1,
      query: const PropertyQuery().withKeyword(' BDS-000123 '),
    );
    await repository.list(page: 1, query: const PropertyQuery());
    final [withKeyword, without] = adapter.requests;
    expect(withKeyword.options.queryParameters, {
      'page': 1,
      'pageSize': 20,
      'q': 'BDS-000123',
    });
    expect(without.options.queryParameters, {'page': 1, 'pageSize': 20});
  });

  test('normalizeKeyword: bỏ khoảng trắng thừa, tối đa 200 ký tự', () {
    expect(normalizeKeyword('  nhà   phố \n Vĩnh Hải  '), 'nhà phố Vĩnh Hải');
    expect(normalizeKeyword('   '), '');
    expect(normalizeKeyword('a' * 250), hasLength(200));
    expect(normalizeKeyword('${'a' * 199} b'), 'a' * 199);
  });

  test('chi tiết và ảnh: đọc đúng kiểu, trường null', () async {
    final adapter = FakeAdapter((options) {
      if (options.path.endsWith('/images')) {
        return (
          200,
          {
            'success': true,
            'message': null,
            'data': [
              {
                'id': 'i1',
                'url': 'https://cdn/1.jpg',
                'thumbnailUrl': null,
                'mimeType': 'image/jpeg',
                'sizeBytes': 1000,
                'width': null,
                'height': null,
                'sortOrder': 0,
                'isCover': true,
                'createdAt': '2026-10-01T00:00:00.000Z',
              },
            ],
          },
        );
      }
      return (
        200,
        {
          'success': true,
          'message': null,
          'data': {
            'id': 'p1',
            'code': 'BDS-000001',
            'title': 'Nhà phố',
            'description': null,
            'transactionType': 'SALE',
            'propertyType': 'HOUSE',
            'price': 3500000000,
            'area': 70.5,
            'pricePerM2': 49645390,
            'bedrooms': null,
            'bathrooms': 2,
            'floors': null,
            'direction': null,
            'roadWidth': 5.5,
            'roadAccess': null,
            'legalStatus': 'PRIVATE_BOOK',
            'provinceId': 'x',
            'districtId': null,
            'wardId': 'y',
            'provinceName': 'Khánh Hòa',
            'wardName': 'Vĩnh Hải',
            'streetAddress': null,
            'latitude': null,
            'longitude': null,
            'status': 'AVAILABLE',
            'ownerId': null,
            'agentId': 'u1',
            'verificationStatus': 'UNVERIFIED',
            'lastVerifiedAt': null,
            'ownerContactVisible': false,
            'owner': null,
            'isFavorite': true,
            'createdAt': '2026-10-01T00:00:00.000Z',
            'updatedAt': '2026-10-08T02:30:00.000Z',
          },
        },
      );
    });
    final repository = PropertiesRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );

    final detail = await repository.detail('p1');
    expect(adapter.requests.last.options.path, '/properties/p1');
    expect(detail.roadWidth, 5.5);
    expect(detail.pricePerM2, 49645390);
    expect(detail.bedrooms, isNull);
    expect(detail.owner, isNull);
    expect(detail.isFavorite, isTrue);
    expect(detail.address, 'Vĩnh Hải, Khánh Hòa');
    expect(detail.updatedAt, DateTime.utc(2026, 10, 8, 2, 30));

    final [image] = await repository.images('p1');
    expect(adapter.requests.last.options.path, '/properties/p1/images');
    expect(image.isCover, isTrue);
    expect(image.thumbnailUrl, isNull);
  });

  test('tạo: POST /properties; sửa: PATCH kèm expectedUpdatedAt', () async {
    final adapter = FakeAdapter((options) {
      if (options.method == 'POST') {
        return (
          201,
          {
            'success': true,
            'message': null,
            'data': {'id': 'n1', 'code': 'BDS-000009'},
          },
        );
      }
      return (
        200,
        {
          'success': true,
          'message': null,
          'data': {
            'id': 'p1',
            'code': 'BDS-000001',
            'title': 'Sửa',
            'propertyType': 'LAND',
            'price': 1,
            'area': 1,
            'status': 'AVAILABLE',
            'verificationStatus': 'UNVERIFIED',
            'provinceId': 'p',
            'wardId': 'w',
            'canEdit': true,
            'updatedAt': '2026-10-09T00:00:00.000Z',
          },
        },
      );
    });
    final repository = PropertiesRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );
    const draft = PropertyDraft(
      title: 'A',
      propertyType: 'LAND',
      price: 1,
      area: 1,
      provinceId: 'p',
      wardId: 'w',
    );

    final created = await repository.create(draft);
    expect(created, (id: 'n1', code: 'BDS-000009'));
    final updated = await repository.update(
      'p1',
      draft,
      expectedUpdatedAt: DateTime.utc(2026, 10, 8, 2, 30),
      withStreetAddress: false,
    );
    expect(updated.canEdit, isTrue);
    final [post, patch] = adapter.requests;
    expect((post.options.method, post.options.path), ('POST', '/properties'));
    expect(
      (patch.options.method, patch.options.path),
      ('PATCH', '/properties/p1'),
    );
    final body = patch.options.data as Map<String, Object?>;
    expect(body['expectedUpdatedAt'], '2026-10-08T02:30:00.000Z');
    expect(body['description'], isNull);
    expect(body.containsKey('description'), isTrue);
    expect(body.containsKey('streetAddress'), isFalse);
  });
}
