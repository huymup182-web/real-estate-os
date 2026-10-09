import 'package:dio/dio.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/network/api_client.dart';
import '../domain/picked_image.dart';
import '../domain/property_detail.dart';

/// Thêm, đổi ảnh bìa, xoá ảnh BĐS (cần `property.edit` với BĐS). Upload 3 bước: xin link → PUT file thẳng lên
/// storage (không qua backend) → xác nhận.
class PropertyImagesRepository {
  PropertyImagesRepository(this._api, this._storage);

  final ApiClient _api;

  /// Dio riêng gọi link storage đã ký: không base URL, không gắn token của app.
  final Dio _storage;

  Future<PropertyImage> upload(
    String propertyId,
    PickedImage image, {
    void Function(double progress)? onProgress,
  }) async {
    final ticket = (await _api.post(
      '/properties/$propertyId/images/upload-url',
      body: {'mimeType': image.mimeType, 'sizeBytes': image.bytes.length},
    )).object;
    final headers = (ticket['headers'] as Map<String, dynamic>? ?? const {})
        .map((key, value) => MapEntry(key, value.toString()));
    try {
      await _storage.put<void>(
        ticket['uploadUrl'] as String,
        data: Stream.fromIterable([image.bytes]),
        options: Options(
          headers: {
            ...headers,
            Headers.contentLengthHeader: image.bytes.length,
          },
        ),
        onSendProgress: onProgress == null
            ? null
            : (sent, total) => onProgress(total <= 0 ? 0 : sent / total),
      );
    } on DioException catch (error) {
      throw ApiException(
        code: error.response == null
            ? ErrorCodes.networkError
            : ErrorCodes.unknown,
        message: error.response == null
            ? 'Không kết nối được nơi lưu ảnh, vui lòng thử lại'
            : 'Tải ảnh lên không thành công, vui lòng thử lại',
        statusCode: error.response?.statusCode,
      );
    }
    final confirmed = await _api.post(
      '/properties/$propertyId/images',
      body: {'imageId': ticket['imageId'], 'mimeType': image.mimeType},
    );
    return PropertyImage.fromJson(confirmed.object);
  }

  Future<void> setCover(String propertyId, String imageId) =>
      _api.post('/properties/$propertyId/images/$imageId/cover');

  /// Xoá mềm; xoá ảnh bìa thì ảnh đầu còn lại thành ảnh bìa.
  Future<void> delete(String propertyId, String imageId) =>
      _api.delete('/properties/$propertyId/images/$imageId');
}
