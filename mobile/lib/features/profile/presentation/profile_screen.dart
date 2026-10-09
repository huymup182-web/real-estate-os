import 'package:flutter/material.dart';

import '../../shell/presentation/placeholder_body.dart';

/// Tab "Tài khoản". Nội dung làm ở TASK-131.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tài khoản')),
      body: const PlaceholderBody(task: 'TASK-131'),
    );
  }
}
