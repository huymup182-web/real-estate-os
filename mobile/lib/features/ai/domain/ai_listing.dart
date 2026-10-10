import 'package:flutter/foundation.dart' show immutable;

/// Kiểu tin AI viết (TASK-136).
enum AiListingStyle {
  professional('PROFESSIONAL', 'Chuyên nghiệp'),
  short('SHORT', 'Ngắn gọn');

  const AiListingStyle(this.code, this.label);

  final String code;
  final String label;
}

/// Tin đăng AI viết (`POST /properties/:id/ai-listing`). Chỉ là bản nháp: không lưu vào BĐS.
@immutable
class AiListing {
  const AiListing({required this.title, required this.description});

  factory AiListing.fromJson(Map<String, dynamic> json) => AiListing(
    title: (json['title'] as String?) ?? '',
    description: (json['description'] as String?) ?? '',
  );

  final String title;
  final String description;
}
