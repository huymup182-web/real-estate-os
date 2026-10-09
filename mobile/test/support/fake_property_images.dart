import 'dart:typed_data';

import 'package:real_estate_os/features/properties/data/property_images_repository.dart';
import 'package:real_estate_os/features/properties/domain/picked_image.dart';
import 'package:real_estate_os/features/properties/domain/property_detail.dart';

/// PropertyImagesRepository giả: [onUpload] mặc định báo tiến độ 50% rồi xong. Ghi lại ảnh đã gửi, ảnh bìa đã
/// đặt, ảnh đã xoá.
class FakePropertyImagesRepository implements PropertyImagesRepository {
  Future<PropertyImage> Function(
    PickedImage image,
    void Function(double progress)? onProgress,
  )
  onUpload = (image, onProgress) async {
    onProgress?.call(0.5);
    return PropertyImage(id: 'new-${image.name}', url: 'https://cdn/new.jpg');
  };
  Future<void> Function(String imageId) onSetCover = (_) async {};
  Future<void> Function(String imageId) onDelete = (_) async {};

  final uploaded = <({String propertyId, String name})>[];
  final covers = <String>[];
  final deleted = <String>[];

  @override
  Future<PropertyImage> upload(
    String propertyId,
    PickedImage image, {
    void Function(double progress)? onProgress,
  }) {
    uploaded.add((propertyId: propertyId, name: image.name));
    return onUpload(image, onProgress);
  }

  @override
  Future<void> setCover(String propertyId, String imageId) {
    covers.add(imageId);
    return onSetCover(imageId);
  }

  @override
  Future<void> delete(String propertyId, String imageId) {
    deleted.add(imageId);
    return onDelete(imageId);
  }
}

/// Ảnh đã chọn trên máy (1 byte, định dạng theo đuôi tên).
PickedImage pickedImage(String name, {int sizeBytes = 1}) => PickedImage(
  name: name,
  bytes: Uint8List(sizeBytes),
  mimeType: mimeTypeOf(name),
);

PropertyImage storedImage(int n, {bool isCover = false}) => PropertyImage(
  id: 'img$n',
  url: 'https://cdn/$n.jpg',
  thumbnailUrl: 'https://cdn/${n}_thumb.webp',
  isCover: isCover,
);
