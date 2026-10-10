import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/detail_section.dart';
import '../../../core/widgets/error_retry.dart';
import '../../auth/presentation/session_controller.dart';
import '../../profile/presentation/profile_screen.dart';
import '../../properties/domain/property_labels.dart';
import '../domain/team.dart';
import 'team_providers.dart';

/// Chi tiết nhóm: phòng ban, trưởng nhóm, danh sách thành viên (trưởng nhóm lên đầu, đánh dấu "bạn"). Kéo xuống
/// để tải lại.
class TeamDetailScreen extends ConsumerWidget {
  const TeamDetailScreen({super.key, required this.teamId});

  final String teamId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(teamDetailProvider(teamId));
    final me = ref.watch(sessionProvider).value?.user?.id;

    Future<void> refresh() async {
      ref.invalidate(teamDetailProvider(teamId));
      try {
        await ref.read(teamDetailProvider(teamId).future);
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(detail.value?.summary.name ?? 'Nhóm')),
      body: switch (detail) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: refresh,
          child: _Body(team: value, me: me),
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: error is ApiException && error.code == ErrorCodes.notFound
                ? Text(
                    'Không tìm thấy nhóm, hoặc bạn không có quyền xem nhóm này.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge,
                  )
                : ErrorRetry(
                    error: error,
                    onRetry: () => ref.invalidate(teamDetailProvider(teamId)),
                  ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.team, required this.me});

  final TeamDetail team;
  final String? me;

  @override
  Widget build(BuildContext context) {
    final summary = team.summary;
    final members = [...team.members]
      ..sort(
        (a, b) =>
            (a.id == summary.leaderId ? 0 : 1) -
            (b.id == summary.leaderId ? 0 : 1),
      );
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(
        top: AppSpacing.s8,
        bottom: AppSpacing.s24,
      ),
      children: [
        DetailSection(
          title: 'Thông tin',
          child: Column(
            children: [
              InfoRow(label: 'Phòng ban', value: summary.departmentName),
              InfoRow(
                label: 'Trưởng nhóm',
                value: summary.leaderName ?? 'Chưa có',
              ),
              InfoRow(
                label: 'Số thành viên',
                value: vnNumber(team.members.length),
              ),
            ],
          ),
        ),
        DetailSection(
          title: 'Thành viên',
          child: members.isEmpty
              ? Text(
                  'Nhóm chưa có thành viên.',
                  style: TextStyle(color: context.appColors.mutedForeground),
                )
              : Card(
                  child: Column(
                    children: [
                      for (final (index, member) in members.indexed) ...[
                        if (index > 0) const Divider(height: 1),
                        _MemberTile(
                          member: member,
                          leader: member.id == summary.leaderId,
                          me: member.id == me,
                        ),
                      ],
                    ],
                  ),
                ),
        ),
      ],
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({
    required this.member,
    required this.leader,
    required this.me,
  });

  final TeamMember member;
  final bool leader;
  final bool me;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            backgroundColor: theme.colorScheme.primaryContainer,
            child: Text(
              initials(member.fullName),
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: AppSpacing.s8,
                  runSpacing: AppSpacing.s4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      me ? '${member.fullName} (bạn)' : member.fullName,
                      style: theme.textTheme.titleMedium,
                    ),
                    if (leader)
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: context.appColors.info,
                          borderRadius: const BorderRadius.all(AppRadius.full),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.s8,
                            vertical: AppSpacing.s2,
                          ),
                          child: Text(
                            'Trưởng nhóm',
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: context.appColors.onInfo,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                if (member.email case final email?)
                  SelectableText(
                    email,
                    style: theme.textTheme.bodyMedium?.copyWith(color: muted),
                  ),
                if (member.status != 'ACTIVE')
                  Text(
                    labelOf(userStatusLabels, member.status),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.error,
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
