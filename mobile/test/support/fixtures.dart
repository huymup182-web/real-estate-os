/// Body `GET /auth/me` mẫu.
const meResponse = {
  'success': true,
  'data': {
    'user': {
      'id': '11111111-1111-4111-8111-111111111111',
      'tenantId': '22222222-2222-4222-8222-222222222222',
      'fullName': 'Nguyễn Văn An',
      'email': 'an@demo.vn',
      'phone': '+84901234567',
      'avatarUrl': null,
      'departmentId': null,
      'status': 'ACTIVE',
    },
    'company': {
      'id': '22222222-2222-4222-8222-222222222222',
      'name': 'Công ty BĐS Demo',
      'slug': 'demo',
    },
    'roles': [
      {'code': 'AGENT', 'name': 'Môi giới'},
    ],
    'permissions': [
      {'code': 'property.view', 'scope': 'COMPANY'},
      {'code': 'customer.view', 'scope': 'OWN'},
    ],
  },
  'message': null,
};

/// Body lỗi chuẩn của backend.
Map<String, Object?> errorBody(String code, [String message = 'Lỗi']) => {
  'success': false,
  'data': null,
  'message': message,
  'error': {'code': code, 'requestId': 'req'},
};
