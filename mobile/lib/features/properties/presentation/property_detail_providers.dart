import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/property_detail.dart';
import 'property_list_controller.dart';

/// Chi tiết một BĐS.
final propertyDetailProvider = FutureProvider.autoDispose
    .family<PropertyDetail, String>(
      (ref, id) => ref.watch(propertiesRepositoryProvider).detail(id),
      retry: (_, _) => null,
    );

/// Ảnh của một BĐS (tải riêng: lỗi ảnh không chặn phần thông tin).
final propertyImagesProvider = FutureProvider.autoDispose
    .family<List<PropertyImage>, String>(
      (ref, id) => ref.watch(propertiesRepositoryProvider).images(id),
      retry: (_, _) => null,
    );
