import 'package:flutter/material.dart';

import '../../shell/presentation/placeholder_body.dart';

/// Tab "Trang chủ". Nội dung làm ở TASK-117.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Trang chủ')),
      body: const PlaceholderBody(task: 'TASK-117'),
    );
  }
}
