import 'dart:async';

import 'package:flutter/foundation.dart';

import '../network/api_client.dart';

/// Gửi lỗi chưa được xử lý của app về backend (`POST /crash-reports`, TASK-159, docs/crash-reporting.md).
///
/// Chỉ gửi thông tin kỹ thuật: loại lỗi, câu lỗi, stack, màn hình (mẫu route như `/properties/:id`, không có id),
/// phiên bản app. Mỗi lỗi chỉ gửi một lần và tối đa [maxReports] lỗi mỗi lần mở app, để một lỗi lặp lại khi vẽ
/// màn hình không gửi liên tục. Gửi hỏng (mất mạng, backend lỗi) thì bỏ qua.
class CrashReporter {
  CrashReporter({
    required this.api,
    required String appVersion,
    this.currentRoute,
    this.maxReports = 10,
  }) : _appVersion = _versionPattern.hasMatch(appVersion) ? appVersion : null;

  /// Độ dài tối đa từng trường, khớp với backend (`CRASH_REPORT_LIMITS`).
  static const nameMax = 200;
  static const messageMax = 2000;
  static const stackMax = 20000;
  static const routeMax = 300;

  static final _versionPattern = RegExp(r'^[\w.+-]{1,50}$');
  static final _routePattern = RegExp(r'^/[^?#\s]*$');

  final ApiClient api;
  final String? _appVersion;

  /// Mẫu route của màn hình đang mở, vd `/properties/:id`.
  final String? Function()? currentRoute;
  final int maxReports;
  final _sent = <String>{};

  /// Gửi một lỗi; không bao giờ ném lỗi.
  Future<void> report(Object error, StackTrace? stack) async {
    final name = _cut(error.runtimeType.toString(), nameMax);
    final message = _cut(error.toString(), messageMax);
    final key = '$name:$message';
    if (_sent.contains(key) || _sent.length >= maxReports) {
      return;
    }
    _sent.add(key);
    final route = _route();
    final trace = stack == null ? '' : _cut(stack.toString(), stackMax);
    try {
      await api.post(
        '/crash-reports',
        body: {
          'platform': 'mobile',
          'name': name.isEmpty ? 'Error' : name,
          'message': message,
          if (trace.isNotEmpty) 'stack': trace,
          'route': ?route,
          'appVersion': ?_appVersion,
        },
      );
    } catch (_) {
      // Báo cáo lỗi không được gây thêm lỗi.
    }
  }

  /// Handler cho [FlutterError.onError]: lỗi khi vẽ màn hình. Lỗi `silent` (vd ảnh không tải được) là lỗi bình
  /// thường, không gửi.
  void onFlutterError(FlutterErrorDetails details) {
    if (!details.silent) {
      unawaited(report(details.exception, details.stack));
    }
  }

  /// Handler cho [PlatformDispatcher.onError]: lỗi bất đồng bộ không có `catch`. Trả true (đã xử lý), vẫn in ra
  /// console khi debug.
  bool onPlatformError(Object error, StackTrace stack) {
    if (kDebugMode) {
      debugPrint('Lỗi chưa xử lý: $error\n$stack');
    }
    unawaited(report(error, stack));
    return true;
  }

  String? _route() {
    try {
      final route = currentRoute?.call();
      return route != null &&
              route.length <= routeMax &&
              _routePattern.hasMatch(route)
          ? route
          : null;
    } catch (_) {
      return null;
    }
  }
}

String _cut(String value, int max) =>
    value.length <= max ? value : value.substring(0, max);

/// Bắt mọi lỗi chưa xử lý của app và gửi qua [reporter]: lỗi khi vẽ màn hình ([FlutterError.onError], vẫn chuyển
/// tiếp cho handler cũ để in ra console) và lỗi bất đồng bộ không có `catch` ([PlatformDispatcher.onError]).
void installCrashReporting(CrashReporter reporter) {
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    previous?.call(details);
    reporter.onFlutterError(details);
  };
  PlatformDispatcher.instance.onError = reporter.onPlatformError;
}
