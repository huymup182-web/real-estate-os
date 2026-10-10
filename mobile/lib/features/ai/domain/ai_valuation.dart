import 'package:flutter/foundation.dart' show immutable;

/// Độ tin cậy của định giá AI: theo số BĐS tương tự và độ phân tán giá/m².
enum AiValuationConfidence {
  high('HIGH', 'Cao'),
  medium('MEDIUM', 'Trung bình'),
  low('LOW', 'Thấp');

  const AiValuationConfidence(this.code, this.label);

  final String code;
  final String label;

  static AiValuationConfidence fromCode(String? code) => values.firstWhere(
    (value) => value.code == code,
    orElse: () => AiValuationConfidence.low,
  );
}

/// Yếu tố làm giá cao hơn (UP), thấp hơn (DOWN) hay không đổi (NEUTRAL) so với BĐS tương tự.
@immutable
class AiValuationFactor {
  const AiValuationFactor({
    required this.factor,
    required this.impact,
    required this.note,
  });

  factory AiValuationFactor.fromJson(Map<String, dynamic> json) =>
      AiValuationFactor(
        factor: (json['factor'] as String?) ?? '',
        impact: (json['impact'] as String?) ?? 'NEUTRAL',
        note: (json['note'] as String?) ?? '',
      );

  final String factor;
  final String impact;
  final String note;
}

/// Một BĐS tương tự dùng để định giá.
@immutable
class AiValuationComparable {
  const AiValuationComparable({
    required this.id,
    required this.code,
    required this.title,
    required this.status,
    required this.price,
    required this.area,
    required this.pricePerM2,
    required this.sameWard,
  });

  factory AiValuationComparable.fromJson(Map<String, dynamic> json) =>
      AiValuationComparable(
        id: json['id'] as String,
        code: json['code'] as String,
        title: (json['title'] as String?) ?? '',
        status: (json['status'] as String?) ?? '',
        price: (json['price'] as num).toInt(),
        area: (json['area'] as num).toDouble(),
        pricePerM2: (json['pricePerM2'] as num).toInt(),
        sameWard: (json['sameWard'] as bool?) ?? false,
      );

  final String id;
  final String code;
  final String title;
  final String status;
  final int price;
  final double area;
  final int pricePerM2;

  /// Cùng phường/xã; không thì nằm trong bán kính 2 km.
  final bool sameWard;
}

/// Định giá AI (`POST /properties/:id/ai-valuation`, TASK-149). Chỉ là tham khảo.
@immutable
class AiValuation {
  const AiValuation({
    required this.estimatePrice,
    required this.estimatePricePerM2,
    required this.rangeLow,
    required this.rangeHigh,
    required this.basePrice,
    required this.adjustmentPercent,
    required this.maxAdjustmentPercent,
    required this.confidence,
    required this.summary,
    required this.askingPrice,
    this.askingVsEstimatePercent,
    this.factors = const [],
    this.comparables = const [],
  });

  factory AiValuation.fromJson(Map<String, dynamic> json) {
    final estimate = json['estimate'] as Map<String, dynamic>;
    final range = json['range'] as Map<String, dynamic>;
    final base = json['base'] as Map<String, dynamic>;
    List<Map<String, dynamic>> objects(Object? value) => [
      ...((value as List<dynamic>?) ?? const [])
          .whereType<Map<String, dynamic>>(),
    ];
    return AiValuation(
      estimatePrice: (estimate['price'] as num).toInt(),
      estimatePricePerM2: (estimate['pricePerM2'] as num).toInt(),
      rangeLow: (range['low'] as num).toInt(),
      rangeHigh: (range['high'] as num).toInt(),
      basePrice: (base['price'] as num).toInt(),
      adjustmentPercent: (json['adjustmentPercent'] as num?)?.toDouble() ?? 0,
      maxAdjustmentPercent:
          (json['maxAdjustmentPercent'] as num?)?.toDouble() ?? 0,
      confidence: AiValuationConfidence.fromCode(json['confidence'] as String?),
      summary: (json['summary'] as String?) ?? '',
      askingPrice: (json['askingPrice'] as num).toInt(),
      askingVsEstimatePercent: (json['askingVsEstimatePercent'] as num?)
          ?.toDouble(),
      factors: [
        for (final item in objects(json['factors']))
          AiValuationFactor.fromJson(item),
      ],
      comparables: [
        for (final item in objects(json['comparables']))
          AiValuationComparable.fromJson(item),
      ],
    );
  }

  final int estimatePrice;
  final int estimatePricePerM2;
  final int rangeLow;
  final int rangeHigh;

  /// Giá gốc từ giá/m² trung vị của BĐS tương tự, trước khi AI chỉnh.
  final int basePrice;
  final double adjustmentPercent;
  final double maxAdjustmentPercent;
  final AiValuationConfidence confidence;
  final String summary;
  final int askingPrice;

  /// Giá chào bán cao (+) hay thấp (−) hơn giá ước tính bao nhiêu %.
  final double? askingVsEstimatePercent;
  final List<AiValuationFactor> factors;
  final List<AiValuationComparable> comparables;
}
