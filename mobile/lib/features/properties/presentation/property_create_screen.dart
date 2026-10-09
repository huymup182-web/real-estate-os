import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import 'property_form.dart';
import 'property_list_controller.dart';

/// Thêm BĐS (cần `property.create`). Người tạo là môi giới phụ trách; lưu xong mở trang chi tiết BĐS vừa tạo.
class PropertyCreateScreen extends ConsumerWidget {
  const PropertyCreateScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Thêm BĐS')),
      body: PropertyForm<({String id, String code})>(
        submitLabel: 'Lưu BĐS',
        submit: ref.read(propertiesRepositoryProvider).create,
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
