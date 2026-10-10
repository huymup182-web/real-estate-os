/**
 * Role mặc định của mỗi công ty và quyền của từng role (phase0/04-RBAC.md mục 4).
 * Phải giống ma trận trong database/src/seed.ts; test backend kiểm tra hai bản khớp nhau.
 */
export type RoleScope = 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY';

export const COMPANY_ADMIN_ROLE = 'COMPANY_ADMIN';

/** Thứ tự role trùng thứ tự cột trong DEFAULT_ROLE_MATRIX. */
export const DEFAULT_ROLES: readonly (readonly [code: string, name: string])[] = [
  [COMPANY_ADMIN_ROLE, 'Quản trị công ty'],
  ['DIRECTOR', 'Giám đốc'],
  ['MANAGER', 'Trưởng phòng'],
  ['TEAM_LEADER', 'Trưởng nhóm'],
  ['AGENT', 'Môi giới'],
  ['COLLABORATOR', 'Cộng tác viên'],
];

const O = 'OWN';
const T = 'TEAM';
const D = 'DEPARTMENT';
const C = 'COMPANY';
const NO = null;

/** Thứ tự cột: COMPANY_ADMIN, DIRECTOR, MANAGER, TEAM_LEADER, AGENT, COLLABORATOR. */
export const DEFAULT_ROLE_MATRIX: Readonly<Record<string, readonly (RoleScope | null)[]>> = {
  'property.view': [C, C, C, C, C, C],
  'property.create': [C, C, C, C, C, C],
  'property.edit': [C, C, D, T, O, O],
  'property.delete': [C, C, D, NO, NO, NO],
  'property.approve': [C, C, D, T, NO, NO],
  'property.view_owner_contact': [C, C, D, T, O, O],
  'property.verify': [C, C, D, T, O, NO],
  'property.view_documents': [C, C, D, T, O, O],
  'property.assign': [C, C, D, T, NO, NO],
  'customer.view': [C, C, D, T, O, O],
  'customer.create': [C, C, C, C, C, C],
  'customer.edit': [C, C, D, T, O, O],
  'customer.assign': [C, C, D, T, NO, NO],
  'customer.delete': [C, C, D, NO, NO, NO],
  'user.view': [C, C, D, T, NO, NO],
  'user.manage': [C, NO, NO, NO, NO, NO],
  'team.view': [C, C, D, T, T, NO],
  'team.manage': [C, C, D, NO, NO, NO],
  'report.view': [C, C, D, T, O, NO],
  'admin.manage': [C, NO, NO, NO, NO, NO],
  'audit.view': [C, C, NO, NO, NO, NO],
  'appointment.view': [C, C, D, T, O, O],
  'appointment.manage': [C, C, D, T, O, O],
  'deal.view': [C, C, D, T, O, NO],
  'deal.manage': [C, C, D, T, O, NO],
  'commission.view': [C, C, D, T, O, O],
  'commission.manage': [C, C, NO, NO, NO, NO],
};
