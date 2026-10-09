import 'package:flutter/material.dart';

import '../../shell/presentation/placeholder_body.dart';

/// Tab "Bất động sản". Nội dung làm ở TASK-118.
class PropertiesScreen extends StatelessWidget {
  const PropertiesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Bất động sản')),
      body: const PlaceholderBody(task: 'TASK-118'),
    );
  }
}
