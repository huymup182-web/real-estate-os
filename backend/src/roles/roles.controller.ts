import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto.js';
import {
  type PermissionInfo,
  type RoleDetail,
  RolesService,
  type RoleSummary,
} from './roles.service.js';

/** Quản lý vai trò của công ty (TASK-104). Mọi route cần `admin.manage`. */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** `GET /api/v1/roles` → vai trò của công ty, kèm số người dùng và số quyền. */
  @Get()
  @RequirePermission('admin.manage')
  list(@TenantId() tenantId: string, @Req() req: { user: RequestUser }): Promise<RoleSummary[]> {
    return this.roles.list(actorOf(tenantId, req.user));
  }

  /** `GET /api/v1/roles/permissions` → danh mục quyền gán được cho vai trò. Khai báo trước `:id`. */
  @Get('permissions')
  @RequirePermission('admin.manage')
  catalog(): Promise<PermissionInfo[]> {
    return this.roles.catalog();
  }

  @Get(':id')
  @RequirePermission('admin.manage')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<RoleDetail> {
    return this.roles.findOne(actorOf(tenantId, req.user), id);
  }

  @Post()
  @RequirePermission('admin.manage')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateRoleDto,
  ): Promise<RoleDetail> {
    return this.roles.create(actorOf(tenantId, req.user), dto, req.user);
  }

  @Patch(':id')
  @RequirePermission('admin.manage')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleDetail> {
    return this.roles.update(actorOf(tenantId, req.user), id, dto, req.user);
  }

  /** `DELETE /api/v1/roles/:id` → 204. Role mặc định hoặc còn người dùng → 422. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('admin.manage')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.roles.remove(actorOf(tenantId, req.user), id);
  }
}
