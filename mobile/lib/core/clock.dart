import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Giờ hiện tại; test thay bằng giờ cố định.
final clockProvider = Provider<DateTime Function()>((ref) => DateTime.now);
