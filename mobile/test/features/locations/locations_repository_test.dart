import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/locations/data/locations_repository.dart';

import '../../support/fake_adapter.dart';

void main() {
  test('đọc tỉnh/thành và phường/xã của một tỉnh', () async {
    final adapter = FakeAdapter(
      (options) => (
        200,
        {
          'success': true,
          'message': null,
          'data': [
            {'id': 'x1', 'code': '56', 'name': 'Khánh Hòa'},
          ],
        },
      ),
    );
    final repository = LocationsRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );

    final [province] = await repository.provinces();
    expect(province.name, 'Khánh Hòa');
    await repository.wards('x1');
    expect(adapter.requests.map((r) => r.options.path), [
      '/locations/provinces',
      '/locations/provinces/x1/wards',
    ]);
  });
}
