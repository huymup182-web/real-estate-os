import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/features/properties/domain/picked_image.dart';

void main() {
  test('định dạng: ưu tiên máy báo, không thì theo đuôi file', () {
    expect(mimeTypeOf('a.JPG'), 'image/jpeg');
    expect(mimeTypeOf('a.jpeg'), 'image/jpeg');
    expect(mimeTypeOf('a.png'), 'image/png');
    expect(mimeTypeOf('a.webp'), 'image/webp');
    expect(mimeTypeOf('IMG_1.HEIC'), 'image/heic');
    expect(mimeTypeOf('a.heif'), 'image/heic');
    expect(mimeTypeOf('a.gif'), isNull);
    expect(mimeTypeOf('noext'), isNull);
    expect(mimeTypeOf('scaled_1', 'image/png'), 'image/png');
    // Máy báo định dạng API không nhận thì xét theo đuôi.
    expect(mimeTypeOf('a.jpg', 'application/octet-stream'), 'image/jpeg');
  });

  test('ảnh sai định dạng hoặc quá 10MB thì có lỗi, không gửi', () {
    PickedImage image(String? mimeType, int size) =>
        PickedImage(name: 'x', bytes: Uint8List(size), mimeType: mimeType);

    expect(image('image/jpeg', maxImageBytes).problem, isNull);
    expect(image('image/jpeg', maxImageBytes + 1).problem, 'Ảnh quá 10MB');
    expect(image('image/gif', 1).problem, 'Chỉ nhận ảnh JPG, PNG, WEBP, HEIC');
    expect(image(null, 1).problem, 'Chỉ nhận ảnh JPG, PNG, WEBP, HEIC');
  });
}
