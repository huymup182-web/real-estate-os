import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { AssignPropertyDto } from './dto/assign-property.dto.js';
import { ChangePropertyStatusDto } from './dto/change-property-status.dto.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { SetPropertyOwnerDto } from './dto/set-property-owner.dto.js';
import { UpdatePropertyDto } from './dto/update-property.dto.js';
import { type Actor, PropertiesService, type PropertyScopes } from './properties.service.js';
import type {
  PropertyDetailResponse,
  PropertyListItem,
  PropertyResponse,
} from './property.response.js';

/** Phạm vi các quyền BĐS của user (route đã có @RequirePermission nên quyền của route chắc chắn có). */
export function scopesOf(user: RequestUser): PropertyScopes {
  return {
    view: user.permissions['property.view'],
    edit: user.permissions['property.edit'],
    delete: user.permissions['property.delete'],
    contact: user.permissions['property.view_owner_contact'],
    assign: user.permissions['property.assign'],
  };
}

export function actorOf(tenantId: string, user: AuthenticatedUser): Actor {
  return { tenantId, userId: user.userId };
}

@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  /** `POST /api/v1/properties` → 201 BĐS vừa tạo (TASK-049). Cần quyền `property.create`. */
  @Post()
  @RequirePermission('property.create')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CreatePropertyDto,
  ): Promise<PropertyResponse> {
    return this.properties.create(actorOf(tenantId, req.user), dto);
  }

  /**
   * `GET /api/v1/properties?page=1&pageSize=20` → danh sách BĐS xem được, mới tạo trước, kèm `meta`
   * phân trang (TASK-051). BĐS HIDDEN chỉ hiện với người sửa được BĐS đó (TASK-054).
   */
  @Get()
  @RequirePermission('property.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<PropertyListItem>> {
    return this.properties.findAll(actorOf(tenantId, req.user), query, scopesOf(req.user));
  }

  /**
   * `GET /api/v1/properties/:id` → chi tiết BĐS (TASK-050). Cần quyền `property.view`; không xem được → 404.
   * Địa chỉ chi tiết, chủ nhà chỉ có khi được xem liên hệ chủ nhà (`property.view_owner_contact`).
   */
  @Get(':id')
  @RequirePermission('property.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PropertyDetailResponse> {
    return this.properties.findOne(actorOf(tenantId, req.user), id, scopesOf(req.user));
  }

  /**
   * `PATCH /api/v1/properties/:id` → chi tiết BĐS sau khi sửa (TASK-052). Cần quyền `property.edit`
   * với BĐS đó; xem được nhưng ngoài phạm vi sửa → 403, không xem được → 404.
   */
  @Patch(':id')
  @RequirePermission('property.edit')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ): Promise<PropertyDetailResponse> {
    return this.properties.update(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /**
   * `POST /api/v1/properties/:id/status` → chi tiết BĐS sau khi đổi trạng thái (TASK-054).
   * Cần quyền `property.edit` với BĐS đó.
   */
  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('property.edit')
  changeStatus(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ChangePropertyStatusDto,
  ): Promise<PropertyDetailResponse> {
    return this.properties.changeStatus(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /**
   * `POST /api/v1/properties/:id/assign` → chi tiết BĐS sau khi đổi môi giới phụ trách (TASK-056).
   * Cần quyền `property.assign` với BĐS đó và với người nhận.
   */
  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('property.assign')
  assign(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AssignPropertyDto,
  ): Promise<PropertyDetailResponse> {
    return this.properties.assign(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /**
   * `PUT /api/v1/properties/:id/owner` → chi tiết BĐS sau khi nhập/thay chủ nhà (TASK-055).
   * Cần quyền `property.edit` và `property.view_owner_contact` với BĐS đó.
   */
  @Put(':id/owner')
  @RequirePermission('property.edit')
  setOwner(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SetPropertyOwnerDto,
  ): Promise<PropertyDetailResponse> {
    return this.properties.setOwner(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /**
   * `DELETE /api/v1/properties/:id/owner` → 204, gỡ chủ nhà khỏi BĐS (TASK-055). Quyền như khi nhập.
   */
  @Delete(':id/owner')
  @HttpCode(204)
  @RequirePermission('property.edit')
  async removeOwner(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.properties.removeOwner(actorOf(tenantId, req.user), id, scopesOf(req.user));
  }

  /**
   * `DELETE /api/v1/properties/:id` → 204 (TASK-053), xoá mềm. Cần quyền `property.delete` với BĐS đó;
   * xem được nhưng ngoài phạm vi xoá → 403, không xem được → 404.
   */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('property.delete')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.properties.remove(actorOf(tenantId, req.user), id, scopesOf(req.user));
  }
}
