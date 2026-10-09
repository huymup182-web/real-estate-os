import { PERMISSION_SCOPES, type PermissionScope, type UserAccess } from './permission.service.js';

/** Một quyền kèm phạm vi, như trong role_permissions. */
export interface PermissionGrant {
  code: string;
  scope: PermissionScope;
}

const rank = (scope: PermissionScope): number => PERMISSION_SCOPES.indexOf(scope);

/**
 * Các quyền trong `grants` vượt quyền của người thao tác: người đó không có quyền này, hoặc có nhưng với phạm vi
 * hẹp hơn. Dùng để chặn leo thang khi gán role hoặc sửa quyền của role (phase0/04-RBAC.md mục 6).
 */
export function exceedingGrants(
  grants: readonly PermissionGrant[],
  access: Pick<UserAccess, 'permissions'>,
): PermissionGrant[] {
  return grants.filter(({ code, scope }) => {
    const own = access.permissions[code];
    return !own || rank(scope) > rank(own);
  });
}
