import 'package:flutter/material.dart';

import '../../shell/presentation/placeholder_body.dart';

/// Tab "Khách hàng". Nội dung làm ở TASK-126.
class CustomersScreen extends StatelessWidget {
  const CustomersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Khách hàng')),
      body: const PlaceholderBody(task: 'TASK-126'),
    );
  }
}
