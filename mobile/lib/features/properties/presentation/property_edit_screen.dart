import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/property_detail.dart';
import '../domain/property_draft.dart';
import 'property_detail_providers.dart';
import 'property_form.dart';
import 'property_list_controller.dart';

/// Sửa BĐS (cần `property.edit` với BĐS). Điền sẵn giá trị hiện tại; lưu xong quay về chi tiết đã cập nhật.
/// Người khác lưu trước (409) thì báo để tải lại, không ghi đè.
class PropertyEditScreen extends ConsumerWidget {
  const PropertyEditScreen({super.key, required this.propertyId});

  final String propertyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(propertyDetailProvider(propertyId));
    return Scaffold(
      appBar: AppBar(title: const Text('Sửa BĐS')),
      body: switch (detail) {
        // Đang tải lại sau khi lưu thì giữ nguyên form cũ cho tới khi màn hình đóng.
        AsyncValue(:final value?) => PropertyForm<PropertyDetail>(
          key: ValueKey(value.updatedAt),
          initial: PropertyDraft.fromDetail(value),
          showStreetAddress: value.ownerContactVisible,
          submitLabel: 'Lưu thay đổi',
          submit: (draft) => _update(ref, value, draft),
          onSaved: (updated) {
            ref.invalidate(propertyDetailProvider(propertyId));
            ref.invalidate(propertyListProvider);
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('Đã lưu thay đổi.')));
            Navigator.of(context).pop();
          },
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: ErrorRetry(
              error: error,
              onRetry: () => ref.invalidate(propertyDetailProvider(propertyId)),
            ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }

  Future<PropertyDetail> _update(
    WidgetRef ref,
    PropertyDetail current,
    PropertyDraft draft,
  ) async {
    try {
      return await ref
          .read(propertiesRepositoryProvider)
          .update(
            current.id,
            draft,
            expectedUpdatedAt: current.updatedAt,
            withStreetAddress: current.ownerContactVisible,
          );
    } on ApiException catch (error) {
      if (error.code == ErrorCodes.conflict) {
        throw ApiException(
          code: error.code,
          message: 'BĐS vừa được người khác sửa. Quay lại, kéo xuống để tải bản mới rồi sửa lại.',
          statusCode: error.statusCode,
        );
      }
      rethrow;
    }
  }
}
