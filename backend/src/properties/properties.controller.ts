import { Body, Controller, Post, Req } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { PropertiesService } from './properties.service.js';
import type { PropertyResponse } from './property.response.js';

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
}
