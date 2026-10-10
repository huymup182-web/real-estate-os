import 'package:real_estate_os/features/teams/data/teams_repository.dart';
import 'package:real_estate_os/features/teams/domain/team.dart';

const teamA = TeamSummary(
  id: 't1',
  name: 'Nhóm Vĩnh Hải',
  departmentName: 'Kinh doanh Nha Trang',
  memberCount: 3,
  leaderId: 'u2',
  leaderName: 'Lê Thị Bình',
);

const teamB = TeamSummary(
  id: 't2',
  name: 'Nhóm Đà Lạt',
  departmentName: 'Kinh doanh Lâm Đồng',
  memberCount: 0,
);

/// TeamsRepository giả: [teams], chi tiết [teamA] có 3 thành viên.
class FakeTeamsRepository implements TeamsRepository {
  List<TeamSummary> teams = const [teamA, teamB];
  Object? failList;
  Object? failDetail;
  int listCalls = 0;
  final detailCalls = <String>[];

  @override
  Future<List<TeamSummary>> list() async {
    listCalls++;
    if (failList case final error?) {
      throw error;
    }
    return teams;
  }

  @override
  Future<TeamDetail> detail(String id) async {
    detailCalls.add(id);
    if (failDetail case final error?) {
      throw error;
    }
    return TeamDetail(
      summary: teams.firstWhere((team) => team.id == id),
      members: id == 't1'
          ? const [
              TeamMember(
                id: 'u1',
                fullName: 'Nguyễn Văn An',
                email: 'an@demo.vn',
                status: 'ACTIVE',
              ),
              TeamMember(
                id: 'u2',
                fullName: 'Lê Thị Bình',
                email: 'binh@demo.vn',
                status: 'ACTIVE',
              ),
              TeamMember(id: 'u3', fullName: 'Phạm Cường', status: 'LOCKED'),
            ]
          : const [],
    );
  }
}
