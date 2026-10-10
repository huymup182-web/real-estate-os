import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/detail_section.dart';
import '../../../core/widgets/error_retry.dart';
import '../../auth/domain/current_user.dart';
import '../../auth/presentation/session_controller.dart';

/// Tab "Tài khoản": hồ sơ của người đang đăng nhập (tên, email, số điện thoại, công ty, vai trò), đổi mật khẩu
/// (khi tài khoản có email) và đăng xuất. Kéo xuống để đọc lại hồ sơ từ máy chủ. Sửa hồ sơ do quản trị viên làm
/// trên web admin.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).value?.user;

    Future<void> refresh() async {
      try {
        await ref.read(sessionProvider.notifier).reload();
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Tài khoản')),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: AppSpacing.s24),
          children: [
            if (user != null) ...[
              _Header(user: user),
              DetailSection(
                title: 'Thông tin',
                child: Column(
                  children: [
                    InfoRow(
                      label: 'Email',
                      value: user.email ?? '—',
                      selectable: user.email != null,
                    ),
                    InfoRow(
                      label: 'Điện thoại',
                      value: user.phone == null ? '—' : vnPhone(user.phone!),
                      selectable: user.phone != null,
                    ),
                    InfoRow(label: 'Công ty', value: user.companyName ?? '—'),
                    InfoRow(
                      label: 'Vai trò',
                      value: user.roles.isEmpty ? '—' : user.roles.join(', '),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.gutter,
                ),
                child: Text(
                  'Muốn sửa tên, số điện thoại, hãy liên hệ quản trị viên của công ty.',
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: context.appColors.mutedForeground),
                ),
              ),
              const SizedBox(height: AppSpacing.s8),
              const Divider(),
              if (user.email != null)
                ListTile(
                  leading: const Icon(Icons.lock_reset),
                  title: const Text('Đổi mật khẩu'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push(AppRoutes.changePassword),
                ),
            ],
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Đăng xuất'),
              onTap: () => _confirmSignOut(context, ref),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Đăng xuất?'),
        content: const Text('Bạn sẽ cần đăng nhập lại để dùng app.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Huỷ'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Đăng xuất'),
          ),
        ],
      ),
    );
    if (confirmed ?? false) {
      await ref.read(sessionProvider.notifier).signOut();
    }
  }
}

/// Chữ cái đầu của chữ đầu và chữ cuối họ tên ("Nguyễn Văn An" → "NA").
String initials(String fullName) {
  final parts = fullName
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) {
    return '?';
  }
  final first = parts.first.characters.first;
  return parts.length == 1
      ? first.toUpperCase()
      : '$first${parts.last.characters.first}'.toUpperCase();
}

class _Header extends StatelessWidget {
  const _Header({required this.user});

  final CurrentUser user;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final avatar = user.avatarUrl;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.gutter),
      child: Row(
        children: [
          CircleAvatar(
            radius: 32,
            backgroundColor: theme.colorScheme.primaryContainer,
            foregroundImage: avatar == null ? null : NetworkImage(avatar),
            onForegroundImageError: avatar == null ? null : (_, _) {},
            child: Text(
              initials(user.fullName),
              style: theme.textTheme.titleLarge?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.s16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(user.fullName, style: theme.textTheme.titleLarge),
                if (user.companyName case final company?)
                  Text(
                    company,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: context.appColors.mutedForeground,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
