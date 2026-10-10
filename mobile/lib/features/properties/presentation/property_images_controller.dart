import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/providers.dart';
import '../data/property_images_repository.dart';
import '../domain/picked_image.dart';
import 'property_detail_providers.dart';
import 'property_list_controller.dart';

final propertyImagesRepositoryProvider = Provider<PropertyImagesRepository>(
  (ref) => PropertyImagesRepository(ref.watch(apiClientProvider), Dio()),
);

/// Nguồn ảnh: thư viện (chọn nhiều) hoặc máy ảnh.
enum PickSource { gallery, camera }

/// Mở trình chọn ảnh của máy, trả ảnh đã đọc (đã thu nhỏ còn cạnh dài ≤ 2560px, chất lượng 85). [limit] là số ảnh
/// còn được thêm. Huỷ thì trả danh sách rỗng.
typedef ImagePickerFn = Future<List<PickedImage>> Function(
  PickSource source,
  int limit,
);

final imagePickerProvider = Provider<ImagePickerFn>((ref) => _pickImages);

Future<List<PickedImage>> _pickImages(PickSource source, int limit) async {
  final picker = ImagePicker();
  const maxSide = 2560.0;
  const quality = 85;
  final files = switch (source) {
    PickSource.camera => [
      ?await picker.pickImage(
        source: ImageSource.camera,
        maxWidth: maxSide,
        maxHeight: maxSide,
        imageQuality: quality,
      ),
    ],
    // pickMultiImage chỉ nhận limit ≥ 2.
    _ when limit < 2 => [
      ?await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: maxSide,
        maxHeight: maxSide,
        imageQuality: quality,
      ),
    ],
    _ => await picker.pickMultiImage(
      maxWidth: maxSide,
      maxHeight: maxSide,
      imageQuality: quality,
      limit: limit,
    ),
  };
  return [
    for (final file in files.take(limit))
      PickedImage(
        name: file.name,
        bytes: await file.readAsBytes(),
        mimeType: mimeTypeOf(file.name, file.mimeType),
      ),
  ];
}

/// Một ảnh đang tải lên (hoặc tải lỗi, chờ thử lại).
class ImageUpload {
  const ImageUpload({
    required this.id,
    required this.image,
    this.progress = 0,
    this.error,
  });

  final int id;
  final PickedImage image;
  final double progress;
  final String? error;

  bool get failed => error != null;
}

/// Hàng đợi tải ảnh lên của một BĐS: tải lần lượt; xong ảnh nào thì bỏ khỏi hàng và tải lại danh sách ảnh.
final propertyImageUploadsProvider = NotifierProvider.autoDispose
    .family<PropertyImageUploads, List<ImageUpload>, String>(
      PropertyImageUploads.new,
    );

class PropertyImageUploads extends Notifier<List<ImageUpload>> {
  PropertyImageUploads(this.propertyId);

  final String propertyId;
  var _nextId = 0;
  var _running = false;

  @override
  List<ImageUpload> build() => const [];

  /// Thêm ảnh vào hàng đợi. Ảnh sai định dạng/quá cỡ vào hàng ở trạng thái lỗi (không gửi).
  void add(List<PickedImage> images) {
    state = [
      ...state,
      for (final image in images)
        ImageUpload(id: _nextId++, image: image, error: image.problem),
    ];
    _run();
  }

  void retry(int id) {
    final upload = _find(id);
    if (upload == null || upload.image.problem != null) {
      return;
    }
    _replace(ImageUpload(id: id, image: upload.image));
    _run();
  }

  void remove(int id) => state = [
    for (final upload in state)
      if (upload.id != id) upload,
  ];

  ImageUpload? _find(int id) =>
      state.where((upload) => upload.id == id).firstOrNull;

  void _replace(ImageUpload next) => state = [
    for (final upload in state) upload.id == next.id ? next : upload,
  ];

  Future<void> _run() async {
    if (_running) {
      return;
    }
    _running = true;
    try {
      while (ref.mounted) {
        final next = state.where((upload) => !upload.failed).firstOrNull;
        if (next == null) {
          break;
        }
        try {
          await ref
              .read(propertyImagesRepositoryProvider)
              .upload(
                propertyId,
                next.image,
                onProgress: (progress) {
                  if (ref.mounted && _find(next.id) != null) {
                    _replace(
                      ImageUpload(
                        id: next.id,
                        image: next.image,
                        progress: progress,
                      ),
                    );
                  }
                },
              );
          if (!ref.mounted) {
            break;
          }
          remove(next.id);
          ref.invalidate(propertyImagesProvider(propertyId));
          ref.invalidate(propertyListProvider);
        } on Object catch (error) {
          if (!ref.mounted) {
            break;
          }
          _replace(
            ImageUpload(
              id: next.id,
              image: next.image,
              error: _messageOf(error),
            ),
          );
        }
      }
    } finally {
      _running = false;
    }
  }
}

String _messageOf(Object error) =>
    error is ApiException ? error.message : 'Tải ảnh lên không thành công';
