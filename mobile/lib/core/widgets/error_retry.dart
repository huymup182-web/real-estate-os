import 'package:flutter/material.dart';

import '../error/api_exception.dart';
import '../theme/app_tokens.dart';

/// Báo lỗi khi tải dữ liệu, kèm nút "Thử lại". Lỗi gọi API thì hiện câu của [ApiException].
class ErrorRetry extends StatelessWidget {
  const ErrorRetry({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  static String messageOf(Object error) => error is ApiException
      ? error.message
      : 'Có lỗi khi tải dữ liệu, vui lòng thử lại';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s8),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: theme.colorScheme.error),
          const SizedBox(width: AppSpacing.s8),
          Expanded(
            child: Text(
              messageOf(error),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Thử lại')),
        ],
      ),
    );
  }
}
