import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Một lần gọi đã ghi lại.
class RecordedRequest {
  RecordedRequest(this.options, this.body);

  final RequestOptions options;
  final Object? body;
}

/// Adapter giả cho Dio: ghi lại request, trả response theo [respond] (status, body JSON) hoặc ném lỗi mạng.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.respond);

  final (int, Object?) Function(RequestOptions options) respond;
  final requests = <RecordedRequest>[];
  bool offline = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(RecordedRequest(options, options.data));
    if (offline) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'offline',
      );
    }
    final (status, body) = respond(options);
    if (body == null) {
      return ResponseBody.fromString('', status);
    }
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
