import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/teams_repository.dart';
import '../domain/team.dart';

final teamsRepositoryProvider = Provider<TeamsRepository>(
  (ref) => TeamsRepository(ref.watch(apiClientProvider)),
);

final teamListProvider = FutureProvider.autoDispose<List<TeamSummary>>(
  (ref) => ref.watch(teamsRepositoryProvider).list(),
  retry: (_, _) => null,
);

final teamDetailProvider = FutureProvider.autoDispose
    .family<TeamDetail, String>(
      (ref, id) => ref.watch(teamsRepositoryProvider).detail(id),
      retry: (_, _) => null,
    );
