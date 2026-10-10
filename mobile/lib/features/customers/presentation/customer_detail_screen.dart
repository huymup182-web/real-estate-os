import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/detail_section.dart';
import '../../../core/widgets/error_retry.dart';
import '../../ai/presentation/ai_customer_summary_sheet.dart';
import '../../ai/presentation/ai_match_sheet.dart';
import '../../ai/presentation/ai_providers.dart';
import '../../auth/presentation/session_controller.dart';
import '../../locations/domain/location_option.dart';
import '../../locations/presentation/location_providers.dart';
import '../../properties/domain/property_labels.dart'
    show labelOf, propertyTypeLabels;
import '../domain/customer_detail.dart';
import '../domain/customer_labels.dart';
import '../domain/preference_summary.dart';
import '../domain/property_match.dart';
import 'customer_card.dart';
import 'customer_detail_providers.dart';
import 'pipeline_controller.dart';
import 'status_sheet.dart';

/// Chi tiết khách: thông tin liên hệ, nhu cầu, BĐS phù hợp, môi giới phụ trách, ghi chú và timeline chăm sóc.
/// Có `customer.edit` thì có nút "Đổi bước". Kéo xuống để tải lại.
class CustomerDetailScreen extends ConsumerWidget {
  const CustomerDetailScreen({super.key, required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(customerDetailProvider(customerId));

    // Kéo xuống tải lại: đang có dữ liệu thì giữ, lỗi thì báo snackbar.
    Future<void> refresh() async {
      ref.invalidate(customerPreferencesProvider(customerId));
      ref.invalidate(customerMatchesProvider(customerId));
      ref.invalidate(customerActivitiesProvider(customerId));
      ref.invalidate(customerDetailProvider(customerId));
      try {
        await ref.read(customerDetailProvider(customerId).future);
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(detail.value?.fullName ?? 'Khách hàng')),
      body: switch (detail) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: refresh,
          child: _Body(customer: value),
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: error is ApiException && error.code == ErrorCodes.notFound
                ? Text(
                    'Không tìm thấy khách, hoặc bạn không có quyền xem khách này.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge,
                  )
                : ErrorRetry(
                    error: error,
                    onRetry: () =>
                        ref.invalidate(customerDetailProvider(customerId)),
                  ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.customer});

  final CustomerDetail customer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    String label(Map<String, String> labels, String? value) =>
        value == null ? '—' : labelOf(labels, value);
    final canEdit =
        ref.watch(sessionProvider).value?.user?.can('customer.edit') ?? false;
    final aiEnabled = ref.watch(aiStatusProvider).value?.enabled ?? false;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: AppSpacing.s24),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            AppSpacing.s16,
            AppSpacing.gutter,
            AppSpacing.s8,
          ),
          child: Wrap(
            spacing: AppSpacing.s8,
            runSpacing: AppSpacing.s8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(customer.fullName, style: theme.textTheme.headlineSmall),
              CustomerStatusBadge(status: customer.status),
            ],
          ),
        ),
        if (canEdit || aiEnabled)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.gutter),
            child: Wrap(
              spacing: AppSpacing.s8,
              runSpacing: AppSpacing.s8,
              children: [
                if (canEdit)
                  OutlinedButton.icon(
                    onPressed: () => _changeStatus(context),
                    icon: const Icon(Icons.swap_horiz),
                    label: const Text('Đổi bước'),
                  ),
                if (aiEnabled)
                  OutlinedButton.icon(
                    onPressed: () => showAiCustomerSummarySheet(
                      context,
                      customerId: customer.id,
                    ),
                    icon: const Icon(Icons.auto_awesome),
                    label: const Text('AI tóm tắt'),
                  ),
              ],
            ),
          ),
        const SizedBox(height: AppSpacing.s8),
        DetailSection(
          title: 'Thông tin',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InfoRow(
                label: 'Điện thoại',
                value: vnPhone(customer.phone),
                selectable: true,
              ),
              InfoRow(
                label: 'Email',
                value: customer.email ?? '—',
                selectable: customer.email != null,
              ),
              InfoRow(
                label: 'Mục đích',
                value: label(customerPurposeLabels, customer.purpose),
              ),
              InfoRow(
                label: 'Thời gian mua',
                value: label(purchaseTimelineLabels, customer.purchaseTimeline),
              ),
              InfoRow(
                label: 'Nguồn khách',
                value: label(customerSourceLabels, customer.source),
              ),
              InfoRow(label: 'Môi giới', value: _agentText(ref)),
              if (customer.status == 'LOST')
                InfoRow(
                  label: 'Lý do mất khách',
                  value: customer.lostReason ?? '—',
                ),
              InfoRow(label: 'Ngày tạo', value: vnDate(customer.createdAt)),
              if (customer.notes case final notes?) ...[
                const SizedBox(height: AppSpacing.s8),
                Text(notes),
              ],
            ],
          ),
        ),
        DetailSection(
          title: 'Nhu cầu',
          child: _Preferences(customerId: customer.id),
        ),
        if (ref.watch(sessionProvider).value?.user?.can('property.view') ??
            false)
          DetailSection(
            title: 'BĐS phù hợp',
            child: _Matches(customerId: customer.id),
          ),
        DetailSection(
          title: 'Hoạt động',
          child: _Timeline(customerId: customer.id),
        ),
      ],
    );
  }

  Future<void> _changeStatus(BuildContext context) async {
    final container = ProviderScope.containerOf(context);
    final messenger = ScaffoldMessenger.of(context);
    final choice = await showStatusSheet(
      context,
      current: customer.status,
      lostReason: customer.lostReason,
    );
    if (choice == null) {
      return;
    }
    final error = await changeCustomerStatus(
      container,
      customer,
      status: choice.status,
      lostReason: choice.lostReason,
    );
    final label = labelOf(customerStatusLabels, choice.status);
    messenger.showSnackBar(
      SnackBar(
        content: Text(switch (error) {
          null => 'Đã chuyển sang bước "$label".',
          ApiException(code: ErrorCodes.conflict) =>
            'Khách vừa được người khác cập nhật. Đã tải lại, vui lòng thử lại.',
          _ => ErrorRetry.messageOf(error),
        }),
      ),
    );
  }

  /// Chưa giao → "Chưa giao"; là mình → tên mình kèm "(bạn)"; người khác → tên nếu xem được, không thì "—".
  String _agentText(WidgetRef ref) {
    final agentId = customer.agentId;
    if (agentId == null) {
      return 'Chưa giao';
    }
    final me = ref.watch(sessionProvider).value?.user;
    if (me?.id == agentId) {
      return '${me!.fullName} (bạn)';
    }
    return ref.watch(agentNameProvider(agentId)).value ?? '—';
  }
}

class _Preferences extends ConsumerWidget {
  const _Preferences({required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = context.appColors.mutedForeground;
    final provinceNames = <String, String>{
      for (final province
          in ref.watch(provincesProvider).value ?? const <LocationOption>[])
        province.id: province.name,
    };
    return switch (ref.watch(customerPreferencesProvider(customerId))) {
      AsyncData(:final value) when value.isEmpty => Text(
        'Chưa nhập nhu cầu.',
        style: TextStyle(color: muted),
      ),
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final preference in value)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.s4),
              child: Text.rich(
                TextSpan(
                  text: preferenceSummary(preference, provinceNames),
                  children: [
                    if (!preference.isActive)
                      TextSpan(
                        text: ' (tạm dừng)',
                        style: TextStyle(color: muted),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
      AsyncError(:final error) => ErrorRetry(
        error: error,
        onRetry: () => ref.invalidate(customerPreferencesProvider(customerId)),
      ),
      _ => const _Loading(),
    };
  }
}

/// BĐS đang bán phù hợp với nhu cầu (điểm do luật chấm). AI bật thì mỗi BĐS có nút "AI giải thích" (TASK-135).
class _Matches extends ConsumerWidget {
  const _Matches({required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = context.appColors.mutedForeground;
    final aiEnabled = ref.watch(aiStatusProvider).value?.enabled ?? false;
    return switch (ref.watch(customerMatchesProvider(customerId))) {
      AsyncData(:final value) when value.isEmpty => Text(
        'Chưa có BĐS đang bán nào phù hợp với nhu cầu của khách.',
        style: TextStyle(color: muted),
      ),
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final match in value)
            _MatchTile(
              customerId: customerId,
              match: match,
              aiEnabled: aiEnabled,
            ),
        ],
      ),
      AsyncError(:final error) => ErrorRetry(
        error: error,
        onRetry: () => ref.invalidate(customerMatchesProvider(customerId)),
      ),
      _ => const _Loading(),
    };
  }
}

class _MatchTile extends StatelessWidget {
  const _MatchTile({
    required this.customerId,
    required this.match,
    required this.aiEnabled,
  });

  final String customerId;
  final PropertyMatch match;
  final bool aiEnabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final label = '${match.code} · ${match.title}';
    return Padding(
      key: Key('match-${match.propertyId}'),
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () =>
                context.push(AppRoutes.propertyDetail(match.propertyId)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: theme.textTheme.titleSmall,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.s8),
                    Text(
                      '${match.score}%',
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: theme.colorScheme.primary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.s2),
                Text(
                  [
                    vnMoneyShort(match.price),
                    '${vnDecimal(match.area)} m²',
                    labelOf(propertyTypeLabels, match.propertyType),
                  ].join(' · '),
                  style: theme.textTheme.bodySmall?.copyWith(color: muted),
                ),
                if (match.summary.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.s2),
                  Text(match.summary),
                ],
              ],
            ),
          ),
          if (aiEnabled)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => showAiMatchSheet(
                  context,
                  customerId: customerId,
                  propertyId: match.propertyId,
                  propertyLabel: label,
                ),
                icon: const Icon(Icons.auto_awesome, size: 18),
                label: const Text('AI giải thích'),
              ),
            ),
        ],
      ),
    );
  }
}

class _Timeline extends ConsumerWidget {
  const _Timeline({required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = context.appColors.mutedForeground;
    final timeline = ref.watch(customerActivitiesProvider(customerId));
    return switch (timeline) {
      AsyncData(:final value) when value.items.isEmpty => Text(
        'Chưa có hoạt động nào.',
        style: TextStyle(color: muted),
      ),
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final activity in value.items) _ActivityTile(activity: activity),
          if (value.loadMoreError case final error?)
            ErrorRetry(
              error: error,
              onRetry: ref
                  .read(customerActivitiesProvider(customerId).notifier)
                  .loadMore,
            )
          else if (value.loadingMore)
            const _Loading()
          else if (value.hasMore)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: ref
                    .read(customerActivitiesProvider(customerId).notifier)
                    .loadMore,
                child: const Text('Xem thêm'),
              ),
            ),
        ],
      ),
      AsyncError(:final error) => ErrorRetry(
        error: error,
        onRetry: () => ref.invalidate(customerActivitiesProvider(customerId)),
      ),
      _ => const _Loading(),
    };
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.activity});

  final CustomerActivity activity;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final heading = [
      '${vnTime(activity.occurredAt)} ${vnDate(activity.occurredAt)}',
      labelOf(activityTypeLabels, activity.type),
      ?activity.userName,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            heading,
            style: theme.textTheme.bodySmall?.copyWith(color: muted),
          ),
          if ((activity.fromStatus, activity.toStatus) case (
            final from?,
            final to?,
          )) ...[
            const SizedBox(height: AppSpacing.s2),
            Text(
              '${labelOf(customerStatusLabels, from)} → '
              '${labelOf(customerStatusLabels, to)}',
            ),
          ],
          if (activity.content case final content?) ...[
            const SizedBox(height: AppSpacing.s2),
            Text(content),
          ],
        ],
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(AppSpacing.s16),
    child: Center(child: CircularProgressIndicator()),
  );
}
