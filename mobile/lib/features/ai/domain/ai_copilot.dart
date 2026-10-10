import 'package:flutter/foundation.dart' show immutable;

/// Những câu Copilot hiểu, theo MASTER_PLAN mục 20 (TASK-143).
const copilotSuggestions = (
  customer: ['Tìm nhà phù hợp khách này', 'Tóm tắt lịch sử khách này'],
  property: ['Viết tin cho căn này', 'Căn này có dễ thương lượng không?'],
  general: [
    'Khách nào cần follow-up hôm nay?',
    'Căn nào dễ thương lượng?',
    'Tìm nhà dưới 5 tỷ, 3 phòng ngủ',
  ],
);

/// Màn hình người dùng mở Copilot: khách hoặc BĐS đang xem (hoặc không có gì).
@immutable
class CopilotContext {
  const CopilotContext({this.customerId, this.propertyId});

  final String? customerId;
  final String? propertyId;

  Map<String, String> toJson() => {
    'customerId': ?customerId,
    'propertyId': ?propertyId,
  };
}

/// BĐS Copilot nhắc tới (tool đã trả), bấm vào xem chi tiết.
@immutable
class CopilotProperty {
  const CopilotProperty({
    required this.id,
    required this.code,
    required this.title,
    required this.price,
    required this.area,
  });

  factory CopilotProperty.fromJson(Map<String, dynamic> json) =>
      CopilotProperty(
        id: json['id'] as String,
        code: json['code'] as String,
        title: json['title'] as String,
        price: (json['price'] as num).toInt(),
        area: (json['area'] as num).toDouble(),
      );

  final String id;
  final String code;
  final String title;
  final int price;
  final double area;
}

/// Khách Copilot nhắc tới bằng mã [ref] (K1, K2…); AI không thấy tên, app hiện tên theo mã.
@immutable
class CopilotCustomer {
  const CopilotCustomer({
    required this.ref,
    required this.id,
    required this.fullName,
    required this.status,
  });

  factory CopilotCustomer.fromJson(Map<String, dynamic> json) =>
      CopilotCustomer(
        ref: json['ref'] as String,
        id: json['id'] as String,
        fullName: json['fullName'] as String,
        status: json['status'] as String,
      );

  final String ref;
  final String id;
  final String fullName;
  final String status;
}

/// Một lượt hội thoại. Câu trả lời của Copilot kèm BĐS, khách tool đã trả.
@immutable
class CopilotTurn {
  const CopilotTurn.user(this.content)
    : fromUser = true,
      properties = const [],
      customers = const [];

  const CopilotTurn.assistant(
    this.content, {
    this.properties = const [],
    this.customers = const [],
  }) : fromUser = false;

  factory CopilotTurn.fromReply(Map<String, dynamic> json) =>
      CopilotTurn.assistant(
        json['reply'] as String,
        properties: [
          for (final item in (json['properties'] as List<dynamic>? ?? const []))
            CopilotProperty.fromJson(item as Map<String, dynamic>),
        ],
        customers: [
          for (final item in (json['customers'] as List<dynamic>? ?? const []))
            CopilotCustomer.fromJson(item as Map<String, dynamic>),
        ],
      );

  final bool fromUser;
  final String content;
  final List<CopilotProperty> properties;
  final List<CopilotCustomer> customers;

  Map<String, String> toJson() => {
    'role': fromUser ? 'user' : 'assistant',
    'content': content,
  };
}
