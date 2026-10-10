import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/ai_repository.dart';
import '../domain/ai_search.dart';

final aiRepositoryProvider = Provider<AiRepository>(
  (ref) => AiRepository(ref.watch(apiClientProvider)),
);

/// AI có bật không và còn bao nhiêu lượt. Lỗi thì coi như AI tắt (ẩn nút), không chặn màn hình.
final aiStatusProvider = FutureProvider.autoDispose<AiStatus>(
  (ref) => ref.watch(aiRepositoryProvider).status(),
  retry: (_, _) => null,
);

/// Lần tìm bằng AI gần nhất ở tab BĐS, để hiện câu AI giải thích phía trên kết quả.
final aiSearchResultProvider =
    NotifierProvider.autoDispose<AiSearchResultController, AiPropertySearch?>(
      AiSearchResultController.new,
    );

class AiSearchResultController extends Notifier<AiPropertySearch?> {
  @override
  AiPropertySearch? build() => null;

  void show(AiPropertySearch result) => state = result;

  void dismiss() => state = null;
}
