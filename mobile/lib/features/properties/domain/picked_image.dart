import 'dart:typed_data';

/// Định dạng ảnh API nhận (`property-images.values.ts`).
const imageMimeTypes = {'image/jpeg', 'image/png', 'image/webp', 'image/heic'};

/// Ảnh tối đa 10MB, mỗi BĐS tối đa 30 ảnh (phase0/05-API-CONVENTIONS.md mục 9).
const maxImageBytes = 10 * 1024 * 1024;
const maxImagesPerProperty = 30;

/// Ảnh người dùng vừa chọn/chụp trên máy, chưa tải lên.
class PickedImage {
  const PickedImage({
    required this.name,
    required this.bytes,
    required this.mimeType,
  });

  final String name;
  final Uint8List bytes;

  /// null khi không nhận ra định dạng.
  final String? mimeType;

  /// Lỗi không gửi lên được (định dạng, dung lượng), hoặc null.
  String? get problem {
    if (mimeType == null || !imageMimeTypes.contains(mimeType)) {
      return 'Chỉ nhận ảnh JPG, PNG, WEBP, HEIC';
    }
    if (bytes.length > maxImageBytes) {
      return 'Ảnh quá 10MB';
    }
    return null;
  }
}

/// Định dạng theo đuôi file khi máy không cho biết.
String? mimeTypeOf(String name, [String? reported]) {
  if (reported != null && imageMimeTypes.contains(reported)) {
    return reported;
  }
  final extension = name.split('.').last.toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'heic' || 'heif' => 'image/heic',
    _ => null,
  };
}
