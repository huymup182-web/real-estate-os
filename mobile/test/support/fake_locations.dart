import 'package:real_estate_os/features/locations/data/locations_repository.dart';
import 'package:real_estate_os/features/locations/domain/location_option.dart';

/// LocationsRepository giả: 2 tỉnh, mỗi tỉnh 2 phường.
class FakeLocationsRepository implements LocationsRepository {
  final wardCalls = <String>[];

  static const provinceList = [
    LocationOption(id: 'kh', code: '56', name: 'Khánh Hòa'),
    LocationOption(id: 'ld', code: '68', name: 'Lâm Đồng'),
  ];

  static const wardsByProvince = {
    'kh': [
      LocationOption(id: 'kh-vh', code: '22333', name: 'Vĩnh Hải'),
      LocationOption(id: 'kh-nnt', code: '22366', name: 'Nam Nha Trang'),
    ],
    'ld': [
      LocationOption(id: 'ld-xh', code: '24778', name: 'Xuân Hương - Đà Lạt'),
      LocationOption(id: 'ld-lb', code: '24800', name: 'Lâm Viên - Đà Lạt'),
    ],
  };

  @override
  Future<List<LocationOption>> provinces() async => provinceList;

  @override
  Future<List<LocationOption>> wards(String provinceId) async {
    wardCalls.add(provinceId);
    return wardsByProvince[provinceId] ?? const [];
  }
}
