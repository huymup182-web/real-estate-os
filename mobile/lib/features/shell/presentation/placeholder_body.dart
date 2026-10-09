import 'package:flutter/material.dart';

/// Nội dung tạm của màn hình chưa làm.
class PlaceholderBody extends StatelessWidget {
  const PlaceholderBody({super.key, required this.task});

  final String task;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        'Đang xây dựng ($task)',
        style: Theme.of(context).textTheme.bodyLarge,
      ),
    );
  }
}
