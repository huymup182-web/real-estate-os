import '../../properties/domain/property_query.dart' show normalizeKeyword;
import 'customer_labels.dart';

/// Điều kiện tìm khách: từ khoá (tên, số điện thoại, email) và các bước pipeline.
class CustomerQuery {
  const CustomerQuery({this.keyword = '', this.statuses = const {}});

  /// Backend nhận `q` tối đa 100 ký tự.
  static const maxKeywordLength = 100;

  final String keyword;

  /// Rỗng là mọi bước.
  final Set<String> statuses;

  bool get isEmpty => keyword.isEmpty && statuses.isEmpty;

  CustomerQuery withKeyword(String text) {
    final normalized = normalizeKeyword(text);
    return CustomerQuery(
      keyword: normalized.length > maxKeywordLength
          ? normalized.substring(0, maxKeywordLength).trimRight()
          : normalized,
      statuses: statuses,
    );
  }

  CustomerQuery withStatuses(Set<String> next) =>
      CustomerQuery(keyword: keyword, statuses: next);

  /// `q`, `status=A,B` (bước theo thứ tự pipeline); không có thì không gửi.
  Map<String, Object?> toQueryParameters() => {
    if (keyword.isNotEmpty) 'q': keyword,
    if (statuses.isNotEmpty)
      'status': [
        for (final status in customerStatusLabels.keys)
          if (statuses.contains(status)) status,
      ].join(','),
  };

  @override
  bool operator ==(Object other) =>
      other is CustomerQuery &&
      other.keyword == keyword &&
      other.statuses.length == statuses.length &&
      other.statuses.containsAll(statuses);

  @override
  int get hashCode => Object.hash(keyword, Object.hashAllUnordered(statuses));

  @override
  String toString() => 'CustomerQuery(keyword: $keyword, statuses: $statuses)';
}
