import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import { ChangeUserStatusDto } from './dto/change-user-status.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserListQueryDto } from './dto/user-list-query.dto.js';
import { type UserFormOptions, type UserResponse, UsersService } from './users.service.js';

/** Quản lý người dùng của công ty (TASK-103). */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** `GET /api/v1/users?q&status&roleId&departmentId&page&pageSize`, trong phạm vi `user.view`. */
  @Get()
  @RequirePermission('user.view')
  list(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: UserListQueryDto,
  ): Promise<Paginated<UserResponse>> {
    return this.users.list(
      actorOf(tenantId, req.user),
      query,
      req.user.permissions['user.view'] ?? 'OWN',
    );
  }

  /** `GET /api/v1/users/options` → role và phòng ban cho form tạo/sửa. Khai báo trước `:id`. */
  @Get('options')
  @RequirePermission('user.manage')
  options(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
  ): Promise<UserFormOptions> {
    return this.users.options(actorOf(tenantId, req.user));
  }

  /** `GET /api/v1/users/:id`; ngoài phạm vi xem → 404. */
  @Get(':id')
  @RequirePermission('user.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<UserResponse> {
    return this.users.findOne(
      actorOf(tenantId, req.user),
      id,
      req.user.permissions['user.view'] ?? 'OWN',
    );
  }

  /** `POST /api/v1/users` → 201 user vừa tạo. */
  @Post()
  @RequirePermission('user.manage')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateUserDto,
  ): Promise<UserResponse> {
    return this.users.create(actorOf(tenantId, req.user), dto, req.user);
  }

  /** `PATCH /api/v1/users/:id` → user sau khi sửa. */
  @Patch(':id')
  @RequirePermission('user.manage')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.users.update(actorOf(tenantId, req.user), id, dto, req.user);
  }

  /** `POST /api/v1/users/:id/status` → 200 user sau khi đổi trạng thái. */
  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('user.manage')
  changeStatus(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ChangeUserStatusDto,
  ): Promise<UserResponse> {
    return this.users.changeStatus(actorOf(tenantId, req.user), id, dto.status, req.user);
  }
}
