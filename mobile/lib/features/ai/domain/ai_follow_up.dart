import 'package:flutter/foundation.dart' show immutable;

/// Việc AI gợi ý làm với khách (TASK-141), nhãn tiếng Việt.
const followUpActionLabels = {
  'CALL': 'Gọi điện',
  'MESSAGE': 'Nhắn tin',
  'SEND_PROPERTIES': 'Gửi BĐS',
  'SCHEDULE_VIEWING': 'Hẹn xem nhà',
};

/// Một khách cần chăm sóc và gợi ý của AI (`POST /ai/follow-ups`).
@immutable
class AiFollowUpItem {
  const AiFollowUpItem({
    required this.customerId,
    required this.fullName,
    required this.status,
    required this.daysSinceContact,
    this.action,
    this.reason,
    this.message,
  });

  factory AiFollowUpItem.fromJson(Map<String, dynamic> json) {
    final customer = json['customer'] as Map<String, dynamic>;
    final suggestion = json['suggestion'] as Map<String, dynamic>?;
    return AiFollowUpItem(
      customerId: customer['id'] as String,
      fullName: customer['fullName'] as String,
      status: customer['status'] as String,
      daysSinceContact: (json['daysSinceContact'] as num).toInt(),
      action: suggestion?['action'] as String?,
      reason: suggestion?['reason'] as String?,
      message: suggestion?['message'] as String?,
    );
  }

  final String customerId;
  final String fullName;
  final String status;
  final int daysSinceContact;

  /// `null` khi AI không gợi ý được cho khách này.
  final String? action;
  final String? reason;
  final String? message;
}

/// Danh sách khách cần chăm sóc: luật chọn khách (quá [thresholdDays] ngày chưa chăm sóc), AI gợi ý việc làm.
@immutable
class AiFollowUps {
  const AiFollowUps({required this.thresholdDays, this.items = const []});

  factory AiFollowUps.fromJson(Map<String, dynamic> json) => AiFollowUps(
    thresholdDays: (json['thresholdDays'] as num).toInt(),
    items: [
      for (final item in (json['items'] as List<dynamic>? ?? const []))
        AiFollowUpItem.fromJson(item as Map<String, dynamic>),
    ],
  );

  final int thresholdDays;
  final List<AiFollowUpItem> items;
}
