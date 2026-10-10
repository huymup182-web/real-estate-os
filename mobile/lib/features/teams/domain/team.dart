/// Nhãn trạng thái tài khoản (khớp backend `users/user-values.ts`, web admin `lib/users.ts`).
const userStatusLabels = {
  'ACTIVE': 'Đang hoạt động',
  'INACTIVE': 'Ngừng hoạt động',
  'LOCKED': 'Đã khoá',
};

/// Một nhóm kinh doanh (`GET /teams`).
class TeamSummary {
  const TeamSummary({
    required this.id,
    required this.name,
    required this.departmentName,
    required this.memberCount,
    this.leaderId,
    this.leaderName,
  });

  factory TeamSummary.fromJson(Map<String, dynamic> json) {
    final leader = json['leader'] as Map<String, dynamic>?;
    return TeamSummary(
      id: json['id'] as String,
      name: json['name'] as String,
      departmentName:
          (json['department'] as Map<String, dynamic>)['name'] as String,
      memberCount: (json['memberCount'] as num).toInt(),
      leaderId: leader?['id'] as String?,
      leaderName: leader?['fullName'] as String?,
    );
  }

  final String id;
  final String name;
  final String departmentName;
  final int memberCount;
  final String? leaderId;
  final String? leaderName;
}

class TeamMember {
  const TeamMember({
    required this.id,
    required this.fullName,
    required this.status,
    this.email,
  });

  factory TeamMember.fromJson(Map<String, dynamic> json) => TeamMember(
    id: json['id'] as String,
    fullName: json['fullName'] as String,
    email: json['email'] as String?,
    status: json['status'] as String,
  );

  final String id;
  final String fullName;
  final String? email;

  /// `userStatusLabels`.
  final String status;
}

/// Chi tiết nhóm kèm thành viên (`GET /teams/:id`).
class TeamDetail {
  const TeamDetail({required this.summary, required this.members});

  factory TeamDetail.fromJson(Map<String, dynamic> json) => TeamDetail(
    summary: TeamSummary.fromJson(json),
    members: [
      for (final member in json['members'] as List<dynamic>)
        TeamMember.fromJson(member as Map<String, dynamic>),
    ],
  );

  final TeamSummary summary;
  final List<TeamMember> members;
}
