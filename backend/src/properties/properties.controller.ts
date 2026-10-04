import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import type { RequestUser } from '../auth/jwt-auth.guard.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { GrantedScope, RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { PropertiesService } from './properties.service.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import type { PropertyDetailResponse, PropertyResponse } from './property.response.js';

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
}
