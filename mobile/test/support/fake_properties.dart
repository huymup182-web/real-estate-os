import 'package:real_estate_os/core/network/api_response.dart';
import 'package:real_estate_os/core/network/page.dart';
import 'package:real_estate_os/features/properties/data/properties_repository.dart';
import 'package:real_estate_os/features/properties/domain/property_detail.dart';
import 'package:real_estate_os/features/properties/domain/property_draft.dart';
import 'package:real_estate_os/features/properties/domain/property_duplicates.dart';
import 'package:real_estate_os/features/properties/domain/property_query.dart';
import 'package:real_estate_os/features/properties/domain/property_summary.dart';

/// PropertiesRepository giả: [onList] trả từng trang (mặc định danh sách rỗng). Điều kiện tìm của lần gọi đang
/// chạy là `listedQueries.last`.
class FakePropertiesRepository implements PropertiesRepository {
  FakePropertiesRepository([
    Future<Page<PropertySummary>> Function(int page)? onList,
  ]) : onList = onList ?? ((_) async => pageOf(const [], total: 0));

  Future<Page<PropertySummary>> Function(int page) onList;
  Future<PropertyDetail> Function(String id) onDetail = (id) async =>
      propertyDetail(id);
  Future<List<PropertyImage>> Function(String id) onImages = (id) async =>
      const [];
  Future<({String id, String code})> Function(PropertyDraft draft) onCreate = (
    draft,
  ) async => (id: 'new-id', code: 'BDS-000099');
  Future<DuplicateReport> Function(PropertyDraft draft) onDuplicateCheck = (
    draft,
  ) async => const DuplicateReport(threshold: 70);
  final duplicateChecks = <PropertyDraft>[];
  Future<PropertyDetail> Function(String id, PropertyDraft draft) onUpdate = (
    id,
    draft,
  ) async => propertyDetail(id, title: draft.title);
  Future<Page<PropertySummary>> Function(int page) onFavorites = (_) async =>
      pageOf(const [], total: 0);
  Future<void> Function(String id, bool favorite) onSetFavorite = (
    id,
    favorite,
  ) async {};
  final favoritePages = <int>[];
  final favoriteCalls = <({String id, bool favorite})>[];
  final detailCalls = <String>[];
  final created = <PropertyDraft>[];
  final updated = <({String id, Map<String, Object?> body})>[];
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

  @override
  Future<Page<PropertySummary>> favorites({required int page}) {
    favoritePages.add(page);
    return onFavorites(page);
  }

  @override
  Future<void> setFavorite(String id, {required bool favorite}) {
    favoriteCalls.add((id: id, favorite: favorite));
    return onSetFavorite(id, favorite);
  }

  @override
  Future<PropertyDetail> detail(String id) {
    detailCalls.add(id);
    return onDetail(id);
  }

  @override
  Future<List<PropertyImage>> images(String id) => onImages(id);

  @override
  Future<PropertyDetail> update(
    String id,
    PropertyDraft draft, {
    required DateTime expectedUpdatedAt,
    required bool withStreetAddress,
  }) {
    updated.add((
      id: id,
      body: draft.toUpdateJson(
        expectedUpdatedAt: expectedUpdatedAt,
        withStreetAddress: withStreetAddress,
      ),
    ));
    return onUpdate(id, draft);
  }

  @override
  Future<({String id, String code})> create(PropertyDraft draft) {
    created.add(draft);
    return onCreate(draft);
  }

  @override
  Future<DuplicateReport> duplicateCheck(PropertyDraft draft) {
    duplicateChecks.add(draft);
    return onDuplicateCheck(draft);
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

PropertySummary property(
  int n, {
  String status = 'AVAILABLE',
  bool isFavorite = false,
}) => PropertySummary(
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
  isFavorite: isFavorite,
);

PropertyDetail propertyDetail(
  String id, {
  String title = 'Nhà phố 2 tầng gần biển',
  bool ownerContactVisible = true,
  bool canEdit = true,
  bool isFavorite = false,
  PropertyOwner? owner = const PropertyOwner(
    fullName: 'Chủ nhà A',
    phone: '+84901234567',
    email: 'chu@a.vn',
  ),
}) => PropertyDetail(
  id: id,
  code: 'BDS-000001',
  title: title,
  description: 'Nhà mới xây, hẻm ô tô.',
  propertyType: 'HOUSE',
  price: 3500000000,
  area: 70.5,
  pricePerM2: 49645390,
  bedrooms: 3,
  bathrooms: 2,
  floors: 2,
  direction: 'SE',
  roadWidth: 6,
  roadAccess: 'CAR',
  legalStatus: 'PRIVATE_BOOK',
  status: 'AVAILABLE',
  verificationStatus: 'VERIFIED',
  lastVerifiedAt: DateTime.utc(2026, 10, 1, 3),
  provinceId: 'kh',
  wardId: 'kh-vh',
  provinceName: 'Khánh Hòa',
  wardName: 'Vĩnh Hải',
  canEdit: canEdit,
  isFavorite: isFavorite,
  streetAddress: ownerContactVisible ? '12 Đường 2/4' : null,
  ownerContactVisible: ownerContactVisible,
  owner: ownerContactVisible ? owner : null,
  updatedAt: DateTime.utc(2026, 10, 8, 2, 30),
);
