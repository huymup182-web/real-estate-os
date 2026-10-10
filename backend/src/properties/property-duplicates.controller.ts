import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { actorOf, scopesOf } from './properties.controller.js';
import { type DuplicateReport, PropertyDuplicatesService } from './property-duplicates.service.js';

/** Cảnh báo BĐS nghi trùng (TASK-144). Chỉ cảnh báo, không chặn hay xoá BĐS nào. */
@Controller('properties')
export class PropertyDuplicatesController {
  constructor(private readonly duplicates: PropertyDuplicatesService) {}

  /**
   * `POST /api/v1/properties/duplicate-check` (body như `POST /properties`) → {threshold, matches}: BĐS sắp
   * đăng có thể trùng BĐS nào trong công ty. Cần `property.create`. Không tạo gì.
   */
  @Post('duplicate-check')
  @HttpCode(200)
  @RequirePermission('property.create')
  checkNew(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreatePropertyDto,
  ): Promise<DuplicateReport> {
    return this.duplicates.checkNew(actorOf(tenantId, req.user), dto, scopesOf(req.user));
  }

  /**
   * `GET /api/v1/properties/:id/duplicates` → {threshold, matches}: BĐS nghi trùng với BĐS `id`, cho admin
   * quyết định. BĐS ngoài phạm vi `property.view` → 404.
   */
  @Get(':id/duplicates')
  @RequirePermission('property.view')
  forProperty(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<DuplicateReport> {
    return this.duplicates.forProperty(actorOf(tenantId, req.user), id, scopesOf(req.user));
  }
}
