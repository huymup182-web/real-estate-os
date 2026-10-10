import 'package:flutter/foundation.dart' show immutable;

/// Kiểu tin AI viết (TASK-136), bài Facebook (TASK-137).
enum AiListingStyle {
  professional('PROFESSIONAL', 'Chuyên nghiệp'),
  short('SHORT', 'Ngắn gọn'),
  facebook(
    'FACEBOOK',
    'Facebook',
    titleLabel: 'Dòng mở đầu',
    bodyLabel: 'Thân bài',
  );

  const AiListingStyle(
    this.code,
    this.label, {
    this.titleLabel = 'Tiêu đề',
    this.bodyLabel = 'Nội dung',
  });

  final String code;
  final String label;

  /// Tên hai phần kết quả: tin đăng có tiêu đề và nội dung, bài Facebook có dòng mở đầu và thân bài.
  final String titleLabel;
  final String bodyLabel;
}

/// Tin đăng AI viết (`POST /properties/:id/ai-listing`). Chỉ là bản nháp: không lưu vào BĐS. [style] là kiểu đã
/// viết (người dùng có thể đổi kiểu sau khi có kết quả).
@immutable
class AiListing {
  const AiListing({
    required this.style,
    required this.title,
    required this.description,
  });

  factory AiListing.fromJson(Map<String, dynamic> json) => AiListing(
    style: AiListingStyle.values.firstWhere(
      (style) => style.code == json['style'],
      orElse: () => AiListingStyle.professional,
    ),
    title: (json['title'] as String?) ?? '',
    description: (json['description'] as String?) ?? '',
  );

  final AiListingStyle style;
  final String title;
  final String description;
}
