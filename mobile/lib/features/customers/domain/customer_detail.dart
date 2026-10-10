/// Chi tiết khách (`GET /customers/:id`).
class CustomerDetail {
  const CustomerDetail({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.email,
    this.purpose,
    this.purchaseTimeline,
    this.source,
    this.agentId,
    this.lostReason,
    this.notes,
  });

  factory CustomerDetail.fromJson(Map<String, dynamic> json) => CustomerDetail(
    id: json['id'] as String,
    fullName: json['fullName'] as String,
    phone: json['phone'] as String,
    status: json['status'] as String,
    createdAt: DateTime.parse(json['createdAt'] as String),
    updatedAt: DateTime.parse(json['updatedAt'] as String),
    email: json['email'] as String?,
    purpose: json['purpose'] as String?,
    purchaseTimeline: json['purchaseTimeline'] as String?,
    source: json['source'] as String?,
    agentId: json['agentId'] as String?,
    lostReason: json['lostReason'] as String?,
    notes: json['notes'] as String?,
  );

  final String id;
  final String fullName;
  final String phone;
  final String status;
  final DateTime createdAt;

  /// Gửi kèm khi đổi bước để không ghi đè thay đổi của người khác.
  final DateTime updatedAt;
  final String? email;
  final String? purpose;
  final String? purchaseTimeline;
  final String? source;

  /// Môi giới phụ trách; null là chưa giao.
  final String? agentId;
  final String? lostReason;
  final String? notes;
}

/// Một nhu cầu của khách (`GET /customers/:id/preferences`), các trường cần để tóm tắt.
class CustomerPreference {
  const CustomerPreference({
    required this.id,
    required this.transactionType,
    required this.isActive,
    this.propertyTypes = const [],
    this.budgetMin,
    this.budgetMax,
    this.areaMin,
    this.areaMax,
    this.bedroomsMin,
    this.provinceIds = const [],
  });

  factory CustomerPreference.fromJson(Map<String, dynamic> json) =>
      CustomerPreference(
        id: json['id'] as String,
        transactionType: json['transactionType'] as String,
        isActive: json['isActive'] as bool? ?? true,
        propertyTypes: _strings(json['propertyTypes']),
        budgetMin: (json['budgetMin'] as num?)?.toInt(),
        budgetMax: (json['budgetMax'] as num?)?.toInt(),
        areaMin: (json['areaMin'] as num?)?.toDouble(),
        areaMax: (json['areaMax'] as num?)?.toDouble(),
        bedroomsMin: (json['bedroomsMin'] as num?)?.toInt(),
        provinceIds: _strings(json['provinceIds']),
      );

  final String id;

  /// `SALE` mua, `RENT` thuê.
  final String transactionType;
  final bool isActive;
  final List<String> propertyTypes;

  /// Đồng.
  final int? budgetMin;
  final int? budgetMax;

  /// m².
  final double? areaMin;
  final double? areaMax;
  final int? bedroomsMin;
  final List<String> provinceIds;
}

/// Một dòng trên timeline chăm sóc khách (`GET /customers/:id/activities`).
class CustomerActivity {
  const CustomerActivity({
    required this.id,
    required this.type,
    required this.occurredAt,
    this.content,
    this.userName,
    this.fromStatus,
    this.toStatus,
  });

  factory CustomerActivity.fromJson(Map<String, dynamic> json) {
    final metadata = json['metadata'] as Map<String, dynamic>? ?? const {};
    return CustomerActivity(
      id: json['id'] as String,
      type: json['type'] as String,
      occurredAt: DateTime.parse(json['occurredAt'] as String),
      content: json['content'] as String?,
      userName: (json['user'] as Map<String, dynamic>?)?['fullName'] as String?,
      fromStatus: metadata['fromStatus'] as String?,
      toStatus: metadata['toStatus'] as String?,
    );
  }

  final String id;
  final String type;
  final DateTime occurredAt;
  final String? content;

  /// Người ghi.
  final String? userName;

  /// Bước trước và sau, với hoạt động đổi bước (`STATUS_CHANGE`).
  final String? fromStatus;
  final String? toStatus;
}

List<String> _strings(Object? value) =>
    (value as List<dynamic>?)?.cast<String>() ?? const [];
