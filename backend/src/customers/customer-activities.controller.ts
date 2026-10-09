import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { type CustomerActivity, CustomerActivitiesService } from './customer-activities.service.js';
import type { ActivityType } from './customer-values.js';
import { customerScopesOf } from './customers.controller.js';
import {
  CreateCustomerActivityDto,
  CreateCustomerNoteDto,
  CustomerActivityQueryDto,
} from './dto/customer-activity.dto.js';

/**
 * Timeline khách hàng (TASK-081): `/api/v1/customers/:customerId/activities`. Hoạt động không sửa,
 * không xoá. Giao khách tự ghi ASSIGNMENT; đổi trạng thái ghi STATUS_CHANGE (TASK-082).
 */
@Controller('customers/:customerId/activities')
export class CustomerActivitiesController {
  constructor(private readonly activities: CustomerActivitiesService) {}

  /** `GET ?type=CALL,NOTE&page&pageSize` → timeline, xảy ra gần đây trước. Cần `customer.view`. */
  @Get()
  @RequirePermission('customer.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Query() query: CustomerActivityQueryDto,
  ): Promise<Paginated<CustomerActivity>> {
    return this.activities.findAll(
      actorOf(tenantId, req.user),
      customerId,
      query,
      customerScopesOf(req.user),
      query.type,
    );
  }

  /** `POST` {type, content?, propertyIds?, occurredAt?} → 201. Cần `customer.edit` với khách. */
  @Post()
  @RequirePermission('customer.edit')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Body() dto: CreateCustomerActivityDto,
  ): Promise<CustomerActivity> {
    return this.activities.create(
      actorOf(tenantId, req.user),
      customerId,
      { ...dto, type: dto.type as ActivityType },
      customerScopesOf(req.user),
      scopesOf(req.user),
    );
  }
}

/** Ghi chú khách hàng (TASK-080): `/api/v1/customers/:customerId/notes`, là hoạt động loại NOTE. */
@Controller('customers/:customerId/notes')
export class CustomerNotesController {
  constructor(private readonly activities: CustomerActivitiesService) {}

  /** `GET ?page&pageSize` → ghi chú của khách, xảy ra gần đây trước. Cần `customer.view`. */
  @Get()
  @RequirePermission('customer.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<CustomerActivity>> {
    return this.activities.findAll(
      actorOf(tenantId, req.user),
      customerId,
      query,
      customerScopesOf(req.user),
      ['NOTE'],
    );
  }

  /** `POST` {content, occurredAt?} → 201 ghi chú vừa thêm. Cần `customer.edit` với khách. */
  @Post()
  @RequirePermission('customer.edit')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Body() dto: CreateCustomerNoteDto,
  ): Promise<CustomerActivity> {
    return this.activities.create(
      actorOf(tenantId, req.user),
      customerId,
      { type: 'NOTE', content: dto.content, occurredAt: dto.occurredAt },
      customerScopesOf(req.user),
      scopesOf(req.user),
    );
  }
}
