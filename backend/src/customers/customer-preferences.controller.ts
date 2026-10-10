import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import type { CustomerPreferenceResponse } from './customer-preference.entity.js';
import { CustomerPreferencesService } from './customer-preferences.service.js';
import { customerScopesOf } from './customers.controller.js';
import {
  CreateCustomerPreferenceDto,
  UpdateCustomerPreferenceDto,
} from './dto/customer-preference.dto.js';

/** Nhu cầu của khách (TASK-078): `/api/v1/customers/:customerId/preferences`. */
@Controller('customers/:customerId/preferences')
export class CustomerPreferencesController {
  constructor(private readonly preferences: CustomerPreferencesService) {}

  /** `GET` → mọi nhu cầu của khách (kể cả đang tắt), tạo trước đứng trước. Cần `customer.view`. */
  @Get()
  @RequirePermission('customer.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
  ): Promise<CustomerPreferenceResponse[]> {
    return this.preferences.findAll(
      actorOf(tenantId, req.user),
      customerId,
      customerScopesOf(req.user),
    );
  }

  /** `POST` → 201 nhu cầu vừa thêm. Cần `customer.edit` với khách. */
  @Post()
  @RequirePermission('customer.edit')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Body() dto: CreateCustomerPreferenceDto,
  ): Promise<CustomerPreferenceResponse> {
    return this.preferences.create(
      actorOf(tenantId, req.user),
      customerId,
      dto,
      customerScopesOf(req.user),
    );
  }

  /** `PATCH /:id` → nhu cầu sau khi sửa. Cần `customer.edit` với khách. */
  @Patch(':id')
  @RequirePermission('customer.edit')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateCustomerPreferenceDto,
  ): Promise<CustomerPreferenceResponse> {
    return this.preferences.update(
      actorOf(tenantId, req.user),
      customerId,
      id,
      dto,
      customerScopesOf(req.user),
    );
  }

  /** `DELETE /:id` → 204, xoá mềm. Cần `customer.edit` với khách. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('customer.edit')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.preferences.remove(
      actorOf(tenantId, req.user),
      customerId,
      id,
      customerScopesOf(req.user),
    );
  }
}
