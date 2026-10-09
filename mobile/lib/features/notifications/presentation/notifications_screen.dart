import 'package:flutter/material.dart';

import '../../shell/presentation/placeholder_body.dart';

/// Tab "Thông báo". Nội dung làm ở TASK-130.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Thông báo')),
      body: const PlaceholderBody(task: 'TASK-130'),
    );
  }
}
