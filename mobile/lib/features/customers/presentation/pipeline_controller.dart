import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../domain/customer_detail.dart';
import 'customer_detail_providers.dart';
import 'customer_list_controller.dart';

/// Số khách ở từng bước pipeline.
final customerPipelineProvider =
    FutureProvider.autoDispose<List<({String status, int count})>>(
      (ref) => ref.watch(customersRepositoryProvider).pipeline(),
      retry: (_, _) => null,
    );

/// Chuyển [customer] sang bước [status]. Xong thì tải lại chi tiết, timeline, danh sách, pipeline. Trả lỗi để
/// màn hình báo; người khác vừa sửa (409) thì tải lại chi tiết luôn. Dùng [container] của app (không phải ref của
/// widget) vì màn hình có thể đã đóng khi API trả về.
Future<Object?> changeCustomerStatus(
  ProviderContainer ref,
  CustomerDetail customer, {
  required String status,
  String? lostReason,
}) async {
  try {
    await ref
        .read(customersRepositoryProvider)
        .changeStatus(
          customer.id,
          status: status,
          lostReason: lostReason,
          expectedUpdatedAt: customer.updatedAt,
        );
  } on Object catch (error) {
    if (error is ApiException && error.code == ErrorCodes.conflict) {
      ref.invalidate(customerDetailProvider(customer.id));
    }
    return error;
  }
  ref
    ..invalidate(customerDetailProvider(customer.id))
    ..invalidate(customerActivitiesProvider(customer.id))
    ..invalidate(customerListProvider)
    ..invalidate(customerPipelineProvider);
  return null;
}
