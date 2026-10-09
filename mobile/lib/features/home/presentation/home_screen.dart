import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/clock.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../auth/presentation/session_controller.dart';
import '../domain/home_summary.dart';
import 'home_providers.dart';

/// Tab "Trang chủ": lời chào, số liệu 30 ngày (khi có `report.view`), lịch hẹn sắp tới (khi có
/// `appointment.view`). Kéo xuống để tải lại.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).value?.user;
    final now = ref.watch(clockProvider)();
    final stats = ref.watch(dashboardStatsProvider);
    final appointments = ref.watch(upcomingAppointmentsProvider);
    final theme = Theme.of(context);

    Future<void> refresh() async {
      ref
        ..invalidate(dashboardStatsProvider)
        ..invalidate(upcomingAppointmentsProvider);
      await Future.wait([
        ref.read(dashboardStatsProvider.future).catchError((_) => null),
        ref.read(upcomingAppointmentsProvider.future).catchError((_) => null),
      ]);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Trang chủ')),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          children: [
            Text(
              '${greeting(now)}, ${firstName(user?.fullName ?? '')}',
              style: theme.textTheme.headlineSmall,
            ),
            if (user?.companyName != null) ...[
              const SizedBox(height: AppSpacing.s4),
              Text(
                user!.companyName!,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: context.appColors.mutedForeground,
                ),
              ),
            ],
            if (stats.value != null || stats.isLoading || stats.hasError) ...[
              const SizedBox(height: AppSpacing.s24),
              const _SectionTitle('30 ngày gần nhất'),
              stats.when(
                data: (data) => _StatsGrid(stats: data!),
                loading: () => const _Loading(),
                error: (error, _) => ErrorRetry(
                  error: error,
                  onRetry: () => ref.invalidate(dashboardStatsProvider),
                ),
              ),
            ],
            if (appointments.value != null ||
                appointments.isLoading ||
                appointments.hasError) ...[
              const SizedBox(height: AppSpacing.s24),
              const _SectionTitle('Lịch hẹn sắp tới'),
              appointments.when(
                data: (items) => items!.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: AppSpacing.s8,
                        ),
                        child: Text(
                          'Chưa có lịch hẹn nào sắp tới.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: context.appColors.mutedForeground,
                          ),
                        ),
                      )
                    : Card(
                        child: Column(
                          children: [
                            for (final (index, item) in items.indexed) ...[
                              if (index > 0) const Divider(),
                              _AppointmentTile(item: item, now: now),
                            ],
                          ],
                        ),
                      ),
                loading: () => const _Loading(),
                error: (error, _) => ErrorRetry(
                  error: error,
                  onRetry: () => ref.invalidate(upcomingAppointmentsProvider),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// "Chào buổi sáng" (4h–11h), "Chào buổi chiều" (11h–18h), còn lại "Chào buổi tối", theo giờ Việt Nam.
String greeting(DateTime now) {
  final hour = toVn(now).hour;
  if (hour >= 4 && hour < 11) {
    return 'Chào buổi sáng';
  }
  return hour >= 11 && hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
}

/// Tên gọi: chữ cuối của họ tên Việt Nam ("Nguyễn Văn An" → "An").
String firstName(String fullName) {
  final parts = fullName.trim().split(RegExp(r'\s+'));
  return parts.last.isEmpty ? 'bạn' : parts.last;
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s8),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: AppSpacing.s16),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.stats});

  final DashboardStats stats;

  @override
  Widget build(BuildContext context) {
    final items = [
      (Icons.apartment, 'BĐS đang bán', stats.activeProperties),
      (Icons.person_add_alt, 'Khách mới', stats.newCustomers),
      (Icons.event, 'Lịch xem nhà', stats.viewings),
      (Icons.handshake_outlined, 'Giao dịch thành công', stats.wonDeals),
    ];
    // Hai thẻ một hàng, cao theo nội dung (chữ to vẫn không tràn).
    return Column(
      children: [
        for (var row = 0; row < items.length; row += 2) ...[
          if (row > 0) const SizedBox(height: AppSpacing.s12),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final (index, (icon, label, value))
                    in items.skip(row).take(2).indexed) ...[
                  if (index > 0) const SizedBox(width: AppSpacing.s12),
                  Expanded(
                    child: _StatCard(icon: icon, label: label, value: value),
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: theme.colorScheme.primary),
            const SizedBox(height: AppSpacing.s8),
            Text(vnNumber(value), style: theme.textTheme.headlineSmall),
            Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: context.appColors.mutedForeground,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AppointmentTile extends StatelessWidget {
  const _AppointmentTile({required this.item, required this.now});

  final UpcomingAppointment item;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.s16,
        vertical: AppSpacing.s12,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  vnTime(item.scheduledAt),
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
                Text(
                  vnDayLabel(item.scheduledAt, now),
                  style: theme.textTheme.bodySmall?.copyWith(color: muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.customerName, style: theme.textTheme.titleMedium),
                Text(
                  '${item.propertyCode} · ${item.propertyTitle}',
                  style: theme.textTheme.bodyMedium?.copyWith(color: muted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (item.location != null)
                  Text(
                    item.location!,
                    style: theme.textTheme.bodyMedium?.copyWith(color: muted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
