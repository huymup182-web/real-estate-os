import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/error/crash_reporter.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';

import '../../support/fake_adapter.dart';

void main() {
  late FakeAdapter adapter;
  late ApiClient api;

  setUp(() {
    adapter = FakeAdapter((_) => (204, null));
    api = ApiClient(
      baseUrl: 'https://api.example.vn/api/v1',
      tokens: MemoryTokenStorage(
        const AuthTokens(accessToken: 'tok', refreshToken: 'r'),
      ),
      dio: Dio()..httpClientAdapter = adapter,
    );
  });

  Map<String, dynamic> body(int index) =>
      adapter.requests[index].body! as Map<String, dynamic>;

  test(
    'gửi POST /crash-reports kèm token, loại lỗi, stack, route, phiên bản',
    () async {
      final reporter = CrashReporter(
        api: api,
        appVersion: '1.0.0+1',
        currentRoute: () => '/properties/:id',
      );
      await reporter.report(StateError('hỏng'), StackTrace.current);

      expect(adapter.requests, hasLength(1));
      final request = adapter.requests.single.options;
      expect(request.method, 'POST');
      expect(request.path, '/crash-reports');
      expect(request.headers['authorization'], 'Bearer tok');
      expect(body(0)['platform'], 'mobile');
      expect(body(0)['name'], 'StateError');
      expect(body(0)['message'], 'Bad state: hỏng');
      expect(body(0)['stack'], contains('crash_reporter_test.dart'));
      expect(body(0)['route'], '/properties/:id');
      expect(body(0)['appVersion'], '1.0.0+1');
    },
  );

  test('cắt độ dài; route hay phiên bản sai định dạng thì bỏ', () async {
    final reporter = CrashReporter(
      api: api,
      appVersion: '1.0 beta',
      currentRoute: () => '/search?q=0909123456',
    );
    await reporter.report('x' * 5000, null);
    expect(body(0)['message'], hasLength(CrashReporter.messageMax));
    expect(body(0).containsKey('route'), isFalse);
    expect(body(0).containsKey('appVersion'), isFalse);
    expect(body(0).containsKey('stack'), isFalse);
  });

  test('mỗi lỗi gửi một lần, tối đa maxReports lỗi', () async {
    final reporter = CrashReporter(api: api, appVersion: 'dev', maxReports: 2);
    await reporter.report(StateError('a'), null);
    await reporter.report(StateError('a'), null);
    await reporter.report(StateError('b'), null);
    await reporter.report(StateError('c'), null);
    expect(adapter.requests.map((r) => (r.body! as Map)['message']), [
      'Bad state: a',
      'Bad state: b',
    ]);
  });

  test('mất mạng hay route lỗi: không ném lỗi', () async {
    adapter.offline = true;
    final reporter = CrashReporter(
      api: api,
      appVersion: 'dev',
      currentRoute: () => throw StateError('chưa có router'),
    );
    await expectLater(reporter.report(StateError('a'), null), completes);
  });

  test(
    'lỗi khi vẽ và lỗi bất đồng bộ đều được gửi, lỗi silent thì không',
    () async {
      final reporter = CrashReporter(api: api, appVersion: 'dev');
      reporter.onFlutterError(
        FlutterErrorDetails(exception: StateError('vẽ hỏng')),
      );
      reporter.onFlutterError(
        FlutterErrorDetails(exception: StateError('ảnh lỗi'), silent: true),
      );
      final handled = reporter.onPlatformError(
        ArgumentError('bất đồng bộ'),
        StackTrace.current,
      );
      await pumpEventQueue();

      expect(handled, isTrue);
      expect(adapter.requests.map((r) => (r.body! as Map)['message']), [
        'Bad state: vẽ hỏng',
        'Invalid argument(s): bất đồng bộ',
      ]);
    },
  );

  test('installCrashReporting chuyển tiếp cho handler cũ rồi gửi', () async {
    final previous = FlutterError.onError;
    final shown = <FlutterErrorDetails>[];
    FlutterError.onError = shown.add;
    addTearDown(() => FlutterError.onError = previous);

    installCrashReporting(CrashReporter(api: api, appVersion: 'dev'));
    FlutterError.onError!(FlutterErrorDetails(exception: StateError('x')));
    await pumpEventQueue();

    expect(shown, hasLength(1));
    expect(adapter.requests, hasLength(1));
  });
}
