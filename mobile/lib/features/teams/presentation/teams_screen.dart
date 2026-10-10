import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/team.dart';
import 'team_providers.dart';

/// Các nhóm người dùng xem được (môi giới: nhóm của mình), theo phòng ban rồi tên. Chạm để xem thành viên. Kéo
/// xuống để tải lại. Tạo, sửa nhóm làm trên web admin.
class TeamsScreen extends ConsumerWidget {
  const TeamsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teams = ref.watch(teamListProvider);

    Future<void> refresh() async {
      ref.invalidate(teamListProvider);
      try {
        await ref.read(teamListProvider.future);
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Nhóm')),
      body: switch (teams) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: refresh,
          child: value.isEmpty
              ? ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(AppSpacing.gutter),
                  children: [
                    const SizedBox(height: AppSpacing.s48),
                    Icon(
                      Icons.groups_outlined,
                      size: 48,
                      color: context.appColors.mutedForeground,
                    ),
                    const SizedBox(height: AppSpacing.s8),
                    Text(
                      'Bạn chưa thuộc nhóm nào.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyLarge
                          ?.copyWith(color: context.appColors.mutedForeground),
                    ),
                  ],
                )
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(AppSpacing.gutter),
                  itemCount: value.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: AppSpacing.s12),
                  itemBuilder: (context, index) => _TeamCard(
                    team: value[index],
                    onTap: () =>
                        context.push(AppRoutes.teamDetail(value[index].id)),
                  ),
                ),
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: ErrorRetry(
              error: error,
              onRetry: () => ref.invalidate(teamListProvider),
            ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _TeamCard extends StatelessWidget {
  const _TeamCard({required this.team, required this.onTap});

  final TeamSummary team;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(team.name, style: theme.textTheme.titleMedium),
                    Text(
                      team.departmentName,
                      style: theme.textTheme.bodyMedium?.copyWith(color: muted),
                    ),
                    const SizedBox(height: AppSpacing.s4),
                    Text(
                      [
                        'Trưởng nhóm: ${team.leaderName ?? 'chưa có'}',
                        '${vnNumber(team.memberCount)} thành viên',
                      ].join(' · '),
                      style: theme.textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: muted),
            ],
          ),
        ),
      ),
    );
  }
}
