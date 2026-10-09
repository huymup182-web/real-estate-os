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

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import type { CustomerResponse } from './customer.response.js';
import { type CustomerScopes, CustomersService } from './customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

/** Phạm vi các quyền khách hàng của user (route đã có @RequirePermission nên quyền của route chắc chắn có). */
export function customerScopesOf(user: RequestUser): CustomerScopes {
  return {
    view: user.permissions['customer.view'],
    edit: user.permissions['customer.edit'],
    delete: user.permissions['customer.delete'],
  };
}

/** Khách hàng (TASK-077). */
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** `POST /api/v1/customers` → 201 khách vừa tạo. Cần `customer.create`. */
  @Post()
  @RequirePermission('customer.create')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customers.create(actorOf(tenantId, req.user), dto);
  }

  /** `GET /api/v1/customers?page=1&pageSize=20` → khách xem được, mới tạo trước. */
  @Get()
  @RequirePermission('customer.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<CustomerResponse>> {
    return this.customers.findAll(actorOf(tenantId, req.user), query, customerScopesOf(req.user));
  }

  /** `GET /api/v1/customers/:id`; không xem được → 404. */
  @Get(':id')
  @RequirePermission('customer.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<CustomerResponse> {
    return this.customers.findOne(actorOf(tenantId, req.user), id, customerScopesOf(req.user));
  }

  /** `PATCH /api/v1/customers/:id` → khách sau khi sửa. Cần `customer.edit`. */
  @Patch(':id')
  @RequirePermission('customer.edit')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customers.update(actorOf(tenantId, req.user), id, dto, customerScopesOf(req.user));
  }

  /** `DELETE /api/v1/customers/:id` → 204, xoá mềm. Cần `customer.delete`. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('customer.delete')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.customers.remove(actorOf(tenantId, req.user), id, customerScopesOf(req.user));
  }
}
