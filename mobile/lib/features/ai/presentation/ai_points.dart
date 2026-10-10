import 'package:flutter/material.dart';

import '../../../core/theme/app_tokens.dart';

/// Một nhóm ý AI viết (tiêu đề và danh sách có biểu tượng), dùng trong các sheet AI.
class AiPoints extends StatelessWidget {
  const AiPoints({
    super.key,
    required this.title,
    required this.icon,
    required this.items,
  });

  final String title;
  final IconData icon;
  final List<String> items;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.s16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleSmall),
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 18),
                const SizedBox(width: AppSpacing.s8),
                Expanded(child: Text(item)),
              ],
            ),
          ),
      ],
    ),
  );
}
