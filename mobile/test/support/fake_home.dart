import 'package:real_estate_os/features/home/data/home_repository.dart';
import 'package:real_estate_os/features/home/domain/home_summary.dart';

/// HomeRepository giả: số liệu và một lịch hẹn sắp tới mẫu.
class FakeHomeRepository implements HomeRepository {
  Future<DashboardStats> Function() onStats = () async => const DashboardStats(
    activeProperties: 1234,
    newCustomers: 8,
    viewings: 5,
    wonDeals: 2,
  );
  Future<List<UpcomingAppointment>> Function() onAppointments = () async => [
    UpcomingAppointment(
      id: 'a1',
      scheduledAt: DateTime.utc(2026, 10, 10, 2, 30),
      customerName: 'Trần Thị Bình',
      propertyCode: 'BDS-0001',
      propertyTitle: 'Nhà phố Vĩnh Hải',
      location: 'Số 1 Đường 2/4',
    ),
  ];
  int statsCalls = 0;
  int appointmentCalls = 0;
  DateTime? appointmentsFrom;

  @override
  Future<DashboardStats> stats() {
    statsCalls++;
    return onStats();
  }

  @override
  Future<List<UpcomingAppointment>> upcomingAppointments(
    DateTime now, {
    int limit = 5,
  }) {
    appointmentCalls++;
    appointmentsFrom = now;
    return onAppointments();
  }
}
