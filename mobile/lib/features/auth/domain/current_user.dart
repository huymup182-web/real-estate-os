/// Người đang đăng nhập, từ `GET /auth/me`. Quyền chỉ dùng để ẩn/hiện giao diện; backend vẫn tự kiểm quyền.
class CurrentUser {
  const CurrentUser({
    required this.id,
    required this.fullName,
    this.email,
    this.phone,
    this.avatarUrl,
    this.companyName,
    this.roles = const [],
    this.permissions = const {},
  });

  factory CurrentUser.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    final company = json['company'] as Map<String, dynamic>?;
    return CurrentUser(
      id: user['id'] as String,
      fullName: user['fullName'] as String,
      email: user['email'] as String?,
      phone: user['phone'] as String?,
      avatarUrl: user['avatarUrl'] as String?,
      companyName: company?['name'] as String?,
      roles: [
        for (final role in (json['roles'] as List<dynamic>? ?? const []))
          (role as Map<String, dynamic>)['name'] as String,
      ],
      permissions: {
        for (final permission
            in (json['permissions'] as List<dynamic>? ?? const []))
          (permission as Map<String, dynamic>)['code'] as String:
              permission['scope'] as String,
      },
    );
  }

  final String id;
  final String fullName;
  final String? email;
  final String? phone;
  final String? avatarUrl;

  /// null với tài khoản nền tảng.
  final String? companyName;

  /// Tên các vai trò, để hiển thị.
  final List<String> roles;

  /// Mã quyền → phạm vi rộng nhất (`OWN`, `TEAM`, `DEPARTMENT`, `COMPANY`...).
  final Map<String, String> permissions;

  bool can(String permission) => permissions.containsKey(permission);
}
