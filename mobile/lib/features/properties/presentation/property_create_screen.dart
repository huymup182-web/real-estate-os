import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../domain/property_draft.dart';
import '../domain/property_duplicates.dart';
import 'property_form.dart';
import 'property_list_controller.dart';

/// Thêm BĐS (cần `property.create`). Người tạo là môi giới phụ trách; lưu xong mở trang chi tiết BĐS vừa tạo.
/// Trước khi lưu kiểm BĐS nghi trùng (TASK-144): có thì hỏi lại, người dùng vẫn lưu được.
class PropertyCreateScreen extends ConsumerWidget {
  const PropertyCreateScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.read(propertiesRepositoryProvider);

    Future<bool> checkDuplicates(PropertyDraft draft) async {
      final DuplicateReport report;
      try {
        report = await repository.duplicateCheck(draft);
      } on Object {
        // Kiểm trùng chỉ để cảnh báo: lỗi thì vẫn cho lưu.
        return true;
      }
      if (report.matches.isEmpty) {
        return true;
      }
      if (!context.mounted) {
        return false;
      }
      return await showDuplicateWarning(context, report) ?? false;
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Thêm BĐS')),
      body: PropertyForm<({String id, String code})>(
        submitLabel: 'Lưu BĐS',
        beforeSubmit: checkDuplicates,
        submit: repository.create,
        onSaved: (created) {
          ref.invalidate(propertyListProvider);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Đã thêm BĐS ${created.code}.')),
          );
          context.pushReplacement(AppRoutes.propertyDetail(created.id));
        },
      ),
    );
  }
}

/// Hỏi lại khi BĐS sắp lưu giống BĐS đã có. true = vẫn lưu, false/null = quay lại sửa.
Future<bool?> showDuplicateWarning(
  BuildContext context,
  DuplicateReport report,
) => showDialog<bool>(
  context: context,
  builder: (context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    return AlertDialog(
      title: const Text('Có thể trùng BĐS đã có'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'BĐS này giống từ ${report.threshold}% trở lên với:',
              style: theme.textTheme.bodyMedium,
            ),
            for (final match in report.matches)
              Padding(
                key: Key('duplicate-${match.code}'),
                padding: const EdgeInsets.only(top: AppSpacing.s12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${match.code} · giống ${match.similarity}%',
                      style: theme.textTheme.titleSmall,
                    ),
                    if (match.title case final title?) Text(title),
                    Text(
                      match.reasons.join(', '),
                      style: theme.textTheme.bodySmall?.copyWith(color: muted),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: AppSpacing.s12),
            Text(
              'Đây chỉ là cảnh báo. Lưu thì admin sẽ xem và quyết định.',
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Xem lại'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Vẫn lưu'),
        ),
      ],
    );
  },
);
