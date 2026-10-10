import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/error/crash_reporter.dart';
import 'core/providers.dart';
import 'core/router/app_router.dart';

void main() {
  final container = ProviderContainer();
  // Ghi nhận lỗi app (TASK-159). Phiên bản truyền lúc build: `--dart-define=APP_VERSION=1.0.0+1`.
  installCrashReporting(
    CrashReporter(
      api: container.read(apiClientProvider),
      appVersion: const String.fromEnvironment(
        'APP_VERSION',
        defaultValue: 'dev',
      ),
      currentRoute: () => container
          .read(routerProvider)
          .routerDelegate
          .currentConfiguration
          .fullPath,
    ),
  );
  runApp(UncontrolledProviderScope(container: container, child: const App()));
}
