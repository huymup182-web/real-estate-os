import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/locations_repository.dart';
import '../domain/location_option.dart';

final locationsRepositoryProvider = Provider<LocationsRepository>(
  (ref) => LocationsRepository(ref.watch(apiClientProvider)),
);

/// Tỉnh/thành, theo tên.
final provincesProvider = FutureProvider.autoDispose<List<LocationOption>>(
  (ref) => ref.watch(locationsRepositoryProvider).provinces(),
  retry: (_, _) => null,
);

/// Phường/xã của một tỉnh/thành, theo tên.
final wardsProvider = FutureProvider.autoDispose
    .family<List<LocationOption>, String>(
      (ref, provinceId) =>
          ref.watch(locationsRepositoryProvider).wards(provinceId),
      retry: (_, _) => null,
    );
