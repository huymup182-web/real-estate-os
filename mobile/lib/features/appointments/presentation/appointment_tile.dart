import 'package:flutter/material.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../properties/domain/property_labels.dart';
import '../domain/appointment.dart';

/// `08:30 – 09:30`, hoặc `08:30` khi không có thời lượng.
String appointmentTimeRange(Appointment appointment) =>
    switch (appointment.endsAt) {
      final end? => '${vnTime(appointment.scheduledAt)} – ${vnTime(end)}',
      null => vnTime(appointment.scheduledAt),
    };

/// Một dòng lịch hẹn trong ngày: giờ, khách, BĐS, địa điểm, trạng thái, kết quả.
class AppointmentTile extends StatelessWidget {
  const AppointmentTile({super.key, required this.appointment, this.onTap});

  final Appointment appointment;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final cancelled = appointment.status == 'CANCELLED';
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s16,
          vertical: AppSpacing.s12,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: AppSpacing.s8,
              runSpacing: AppSpacing.s4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  appointmentTimeRange(appointment),
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: cancelled ? muted : theme.colorScheme.primary,
                    decoration: cancelled ? TextDecoration.lineThrough : null,
                  ),
                ),
                AppointmentStatusBadge(status: appointment.status),
              ],
            ),
            const SizedBox(height: AppSpacing.s4),
            Text(appointment.customerName, style: theme.textTheme.titleMedium),
            Text(
              '${appointment.propertyCode} · ${appointment.propertyTitle}',
              style: theme.textTheme.bodyMedium?.copyWith(color: muted),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            if (appointment.location case final location?)
              Text(
                location,
                style: theme.textTheme.bodyMedium?.copyWith(color: muted),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            if (appointment.outcome case final outcome?)
              Text(
                'Kết quả: ${labelOf(appointmentOutcomeLabels, outcome)}',
                style: theme.textTheme.bodyMedium,
              ),
          ],
        ),
      ),
    );
  }
}

class AppointmentStatusBadge extends StatelessWidget {
  const AppointmentStatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (status) {
      'COMPLETED' => (colors.success, colors.onSuccess),
      'NO_SHOW' => (colors.warning, colors.onWarning),
      'CANCELLED' => (scheme.inverseSurface, scheme.onInverseSurface),
      _ => (colors.info, colors.onInfo),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: const BorderRadius.all(AppRadius.full),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s8,
          vertical: AppSpacing.s2,
        ),
        child: Text(
          labelOf(appointmentStatusLabels, status),
          style: Theme.of(context).textTheme.labelMedium
              ?.copyWith(color: foreground),
        ),
      ),
    );
  }
}
