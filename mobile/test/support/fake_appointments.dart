import 'package:real_estate_os/features/appointments/data/appointments_repository.dart';
import 'package:real_estate_os/features/appointments/domain/appointment.dart';

/// Một lịch hẹn mẫu.
Appointment appointment(
  String id,
  DateTime scheduledAt, {
  String status = 'SCHEDULED',
  String? outcome,
  int? durationMinutes = 60,
  String customerName = 'Trần Thị Bình',
  String? location = 'Số 1 Đường 2/4',
}) => Appointment(
  id: id,
  customerId: 'c-$id',
  customerName: customerName,
  propertyId: 'p-$id',
  propertyCode: 'BDS-0001',
  propertyTitle: 'Nhà phố Vĩnh Hải',
  scheduledAt: scheduledAt,
  status: status,
  updatedAt: DateTime.utc(2026, 10, 1),
  durationMinutes: durationMinutes,
  location: location,
  outcome: outcome,
);

/// AppointmentsRepository giả: [onRange] trả lịch theo khoảng (mặc định [items] lọc theo khoảng).
class FakeAppointmentsRepository implements AppointmentsRepository {
  FakeAppointmentsRepository([this.items = const []]);

  List<Appointment> items;
  Future<List<Appointment>> Function(DateTime from, DateTime to)? onRange;
  Future<Appointment> Function(String id, String status, String? outcome)?
  onChangeStatus;
  final ranges = <(DateTime, DateTime)>[];
  final statusChanges =
      <({String id, String status, String? outcome, DateTime expected})>[];

  @override
  Future<List<Appointment>> range(DateTime from, DateTime to) async {
    ranges.add((from, to));
    if (onRange case final handler?) {
      return handler(from, to);
    }
    return [
      for (final item in items)
        if (!item.scheduledAt.isBefore(from) && item.scheduledAt.isBefore(to))
          item,
    ];
  }

  @override
  Future<Appointment> changeStatus(
    String id, {
    required String status,
    String? outcome,
    required DateTime expectedUpdatedAt,
  }) async {
    statusChanges.add((
      id: id,
      status: status,
      outcome: outcome,
      expected: expectedUpdatedAt,
    ));
    if (onChangeStatus case final handler?) {
      return handler(id, status, outcome);
    }
    final index = items.indexWhere((item) => item.id == id);
    final current = items[index];
    final updated = appointment(
      id,
      current.scheduledAt,
      status: status,
      outcome: status == 'COMPLETED' ? outcome : null,
      durationMinutes: current.durationMinutes,
      customerName: current.customerName,
      location: current.location,
    );
    items = [...items]..[index] = updated;
    return updated;
  }
}
