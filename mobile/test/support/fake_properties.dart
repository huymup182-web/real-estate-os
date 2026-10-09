import 'package:real_estate_os/core/network/api_response.dart';
import 'package:real_estate_os/core/network/page.dart';
import 'package:real_estate_os/features/properties/data/properties_repository.dart';
import 'package:real_estate_os/features/properties/domain/property_query.dart';
import 'package:real_estate_os/features/properties/domain/property_summary.dart';

/// PropertiesRepository giả: [onList] trả từng trang (mặc định danh sách rỗng). Điều kiện tìm của lần gọi đang
/// chạy là `listedQueries.last`.
class FakePropertiesRepository implements PropertiesRepository {
  FakePropertiesRepository([
    Future<Page<PropertySummary>> Function(int page)? onList,
  ]) : onList = onList ?? ((_) async => pageOf(const [], total: 0));

  Future<Page<PropertySummary>> Function(int page) onList;
  final listedPages = <int>[];
  final listedQueries = <PropertyQuery>[];

  @override
  Future<Page<PropertySummary>> list({
    required int page,
    PropertyQuery query = const PropertyQuery(),
  }) {
    listedPages.add(page);
    listedQueries.add(query);
    return onList(page);
  }
}

Page<PropertySummary> pageOf(
  List<PropertySummary> items, {
  int page = 1,
  int pageSize = 20,
  required int total,
}) => Page(
  items: items,
  meta: PageMeta(
    page: page,
    pageSize: pageSize,
    total: total,
    totalPages: (total / pageSize).ceil(),
  ),
);

PropertySummary property(int n, {String status = 'AVAILABLE'}) =>
    PropertySummary(
      id: 'p$n',
      code: 'BDS-${n.toString().padLeft(6, '0')}',
      title: 'Nhà phố số $n',
      propertyType: 'HOUSE',
      price: 3500000000,
      area: 70.5,
      status: status,
      provinceName: 'Khánh Hòa',
      wardName: 'Vĩnh Hải',
      bedrooms: 3,
      bathrooms: 2,
    );
