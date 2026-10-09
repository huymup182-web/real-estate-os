/// Điều kiện tìm BĐS gửi lên `GET /properties`. Lọc thêm ở TASK-120.
class PropertyQuery {
  const PropertyQuery({this.keyword = ''});

  /// Từ khoá (mã BĐS hoặc chữ trong tiêu đề, mô tả, địa chỉ), đã chuẩn hoá bằng [normalizeKeyword].
  final String keyword;

  static const maxKeywordLength = 200;

  bool get isEmpty => keyword.isEmpty;

  PropertyQuery withKeyword(String text) =>
      PropertyQuery(keyword: normalizeKeyword(text));

  Map<String, Object> toQueryParameters() => {
    if (keyword.isNotEmpty) 'q': keyword,
  };

  @override
  bool operator ==(Object other) =>
      other is PropertyQuery && other.keyword == keyword;

  @override
  int get hashCode => keyword.hashCode;
}

/// Bỏ khoảng trắng thừa, cắt còn [PropertyQuery.maxKeywordLength] ký tự (giới hạn của API).
String normalizeKeyword(String text) {
  final collapsed = text.trim().replaceAll(RegExp(r'\s+'), ' ');
  return collapsed.length <= PropertyQuery.maxKeywordLength
      ? collapsed
      : collapsed.substring(0, PropertyQuery.maxKeywordLength).trimRight();
}
