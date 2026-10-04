import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import type { RequestUser } from '../auth/jwt-auth.guard.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { GrantedScope, RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { UpdatePropertyDto } from './dto/update-property.dto.js';
import { PropertiesService } from './properties.service.js';
import type { Paginated } from '../common/response/paginated.js';
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import type {
  PropertyDetailResponse,
  PropertyListItem,
  PropertyResponse,
} from './property.response.js';

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
    return this.properties.create({ tenantId, userId: req.user.userId }, dto);
  }

  /**
   * `GET /api/v1/properties?page=1&pageSize=20` → danh sách BĐS trong phạm vi `property.view`,
   * mới tạo trước, kèm `meta` phân trang (TASK-051).
   */
  @Get()
  @RequirePermission('property.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @GrantedScope() viewScope: PermissionScope,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<PropertyListItem>> {
    return this.properties.findAll(
      { tenantId, userId: req.user.userId },
      query,
      viewScope,
      req.user.permissions['property.view_owner_contact'],
    );
  }

  /**
   * `GET /api/v1/properties/:id` → chi tiết BĐS (TASK-050). Cần quyền `property.view`; ngoài phạm vi → 404.
   * Địa chỉ chi tiết, chủ nhà chỉ có khi được xem liên hệ chủ nhà (`property.view_owner_contact`).
   */
  @Get(':id')
  @RequirePermission('property.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @GrantedScope() viewScope: PermissionScope,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PropertyDetailResponse> {
    return this.properties.findOne(
      { tenantId, userId: req.user.userId },
      id,
      viewScope,
      req.user.permissions['property.view_owner_contact'],
    );
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
    @GrantedScope() editScope: PermissionScope,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ): Promise<PropertyDetailResponse> {
    const { permissions } = req.user;
    return this.properties.update({ tenantId, userId: req.user.userId }, id, dto, {
      view: permissions['property.view'],
      edit: editScope,
      contact: permissions['property.view_owner_contact'],
    });
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
    @GrantedScope() deleteScope: PermissionScope,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.properties.remove({ tenantId, userId: req.user.userId }, id, {
      view: req.user.permissions['property.view'],
      delete: deleteScope,
    });
  }
}
