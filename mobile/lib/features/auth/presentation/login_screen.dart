import 'package:flutter/material.dart';

import '../../shell/presentation/placeholder_body.dart';

/// Màn đăng nhập. Form đăng nhập làm ở TASK-116.
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Đăng nhập')),
      body: const PlaceholderBody(task: 'TASK-116'),
    );
  }
}
