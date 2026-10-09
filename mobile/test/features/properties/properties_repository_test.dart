import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/properties/data/properties_repository.dart';

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
}
