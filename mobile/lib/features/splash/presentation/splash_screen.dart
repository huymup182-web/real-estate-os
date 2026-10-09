import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../auth/presentation/session_controller.dart';

/// Màn đầu tiên khi mở app: logo, tên app, kiểm phiên đăng nhập đã lưu. Router tự chuyển sang trang chủ hoặc
/// màn đăng nhập khi kiểm xong; không kết nối được máy chủ thì hiện lỗi và nút thử lại.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final error = session.hasError && !session.isLoading ? session.error : null;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: scheme.primary,
                    borderRadius: const BorderRadius.all(AppRadius.xxl),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.s16),
                    child: Icon(
                      Icons.apartment,
                      size: 48,
                      color: scheme.onPrimary,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.s16),
                Text('Real Estate OS', style: theme.textTheme.headlineMedium),
                const SizedBox(height: AppSpacing.s4),
                Text(
                  'Quản lý bất động sản cho môi giới',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: context.appColors.mutedForeground,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.s32),
                if (error == null)
                  const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  )
                else ...[
                  Text(
                    error is ApiException
                        ? error.message
                        : 'Có lỗi khi mở app, vui lòng thử lại',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: scheme.error,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.s16),
                  FilledButton(
                    onPressed: () => ref.read(sessionProvider.notifier).retry(),
                    child: const Text('Thử lại'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
