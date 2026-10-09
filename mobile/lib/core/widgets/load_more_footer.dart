import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';
import 'error_retry.dart';

/// Cuối danh sách nhiều trang: đang tải thêm, lỗi tải thêm (nút thử lại), hoặc trống khi đã hết.
class LoadMoreFooter extends StatelessWidget {
  const LoadMoreFooter({
    super.key,
    required this.loading,
    required this.error,
    required this.onRetry,
  });

  final bool loading;
  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return ErrorRetry(error: error!, onRetry: onRetry);
    }
    if (loading) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.s16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return const SizedBox(height: AppSpacing.s16);
  }
}
