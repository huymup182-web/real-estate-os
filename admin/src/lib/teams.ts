import { type BackendDeps, callBackend } from './backend.ts';

/** `GET /teams` (TASK-106). */
export interface Team {
  id: string;
  name: string;
  department: { id: string; name: string };
  leader: { id: string; fullName: string } | null;
  memberCount: number;
}

export interface TeamMember {
  id: string;
  fullName: string;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}

export interface TeamDetail extends Team {
  members: TeamMember[];
  canManage: boolean;
}

/** `GET /teams/options`: phòng ban tạo team được, người dùng đang hoạt động của các phòng ban đó. */
export interface TeamOptions {
  departments: { id: string; name: string }[];
  users: { id: string; fullName: string; email: string | null; departmentId: string }[];
}

export function listTeams(token: string, deps?: BackendDeps) {
  return callBackend<Team[]>('/teams', { accessToken: token }, deps);
}

export function getTeam(token: string, id: string, deps?: BackendDeps) {
  return callBackend<TeamDetail>(`/teams/${encodeURIComponent(id)}`, { accessToken: token }, deps);
}

export function getTeamOptions(token: string, deps?: BackendDeps) {
  return callBackend<TeamOptions>('/teams/options', { accessToken: token }, deps);
}

export function createTeam(token: string, body: TeamPayload, deps?: BackendDeps) {
  return callBackend<TeamDetail>('/teams', { method: 'POST', body, accessToken: token }, deps);
}

export function updateTeam(token: string, id: string, body: TeamPayload, deps?: BackendDeps) {
  return callBackend<TeamDetail>(
    `/teams/${encodeURIComponent(id)}`,
    { method: 'PATCH', body, accessToken: token },
    deps,
  );
}

export function deleteTeam(token: string, id: string, deps?: BackendDeps) {
  return callBackend<null>(
    `/teams/${encodeURIComponent(id)}`,
    { method: 'DELETE', accessToken: token },
    deps,
  );
}

export interface TeamFormValues {
  name: string;
  departmentId: string;
  leaderId: string;
  memberIds: string[];
}

export interface TeamPayload {
  name: string;
  departmentId: string;
  leaderId: string | null;
  memberIds: string[];
}

export interface TeamFormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: TeamFormValues;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function readTeamForm(formData: FormData): TeamFormValues {
  const memberIds = formData
    .getAll('memberIds')
    .filter((value): value is string => typeof value === 'string' && value !== '');
  return {
    name: text(formData, 'name'),
    departmentId: text(formData, 'departmentId'),
    leaderId: text(formData, 'leaderId'),
    memberIds: [...new Set(memberIds)],
  };
}

export function validateTeamForm(values: TeamFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.name) {
    errors['name'] = 'Vui lòng nhập tên team';
  }
  if (!values.departmentId) {
    errors['departmentId'] = 'Vui lòng chọn phòng ban';
  }
  return errors;
}

export function teamPayload(values: TeamFormValues): TeamPayload {
  return {
    name: values.name,
    departmentId: values.departmentId,
    leaderId: values.leaderId || null,
    memberIds: values.memberIds,
  };
}

/**
 * Người chọn được cho team thuộc `departmentId`: người dùng đang hoạt động của phòng ban đó, cộng các
 * thành viên hiện tại (kể cả đã ngừng hoạt động) để form không âm thầm bỏ họ ra khỏi team.
 */
export function peopleFor(
  options: TeamOptions,
  departmentId: string,
  current: readonly TeamMember[] = [],
): { id: string; fullName: string; inactive: boolean }[] {
  const people = new Map<string, { id: string; fullName: string; inactive: boolean }>();
  for (const member of current) {
    people.set(member.id, {
      id: member.id,
      fullName: member.fullName,
      inactive: member.status !== 'ACTIVE',
    });
  }
  for (const user of options.users) {
    if (user.departmentId === departmentId) {
      people.set(user.id, { id: user.id, fullName: user.fullName, inactive: false });
    }
  }
  return [...people.values()].sort(
    (a, b) => a.fullName.localeCompare(b.fullName, 'vi') || a.id.localeCompare(b.id),
  );
}
