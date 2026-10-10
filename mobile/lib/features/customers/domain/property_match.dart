import 'package:flutter/foundation.dart' show immutable;

/// Một BĐS phù hợp với khách (`GET /customers/:id/matching-properties`, TASK-090). Điểm do luật chấm.
@immutable
class PropertyMatch {
  const PropertyMatch({
    required this.propertyId,
    required this.code,
    required this.title,
    required this.propertyType,
    required this.price,
    required this.area,
    required this.score,
    required this.summary,
  });

  factory PropertyMatch.fromJson(Map<String, dynamic> json) {
    final property = json['property'] as Map<String, dynamic>;
    final explanation = json['explanation'] as Map<String, dynamic>?;
    return PropertyMatch(
      propertyId: property['id'] as String,
      code: property['code'] as String,
      title: property['title'] as String,
      propertyType: property['propertyType'] as String,
      price: (property['price'] as num).toInt(),
      area: (property['area'] as num).toDouble(),
      score: (json['score'] as num).toInt(),
      summary: (explanation?['summary'] as String?) ?? '',
    );
  }

  final String propertyId;
  final String code;
  final String title;
  final String propertyType;
  final int price;
  final double area;

  /// 0–100.
  final int score;

  /// Câu giải thích dựng sẵn từ tiêu chí (TASK-089), không dùng AI.
  final String summary;
}
