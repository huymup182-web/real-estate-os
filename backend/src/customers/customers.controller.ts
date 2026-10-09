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
import type { UserAccess } from '../auth/permission.service.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import type { CustomerResponse } from './customer.response.js';
import {
  type CustomerDashboard,
  type CustomerScopes,
  CustomersService,
} from './customers.service.js';
import { AssignCustomerDto } from './dto/assign-customer.dto.js';
import { ChangeCustomerStatusDto } from './dto/change-customer-status.dto.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { CustomerDashboardQueryDto } from './dto/customer-dashboard-query.dto.js';
import { CustomerListQueryDto } from './dto/customer-list-query.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

/** Phạm vi các quyền khách hàng của user (route đã có @RequirePermission nên quyền của route chắc chắn có). */
export function customerScopesOf(user: RequestUser): CustomerScopes {
  return customerScopesFrom(user.permissions);
}

/** Phạm vi quyền khách hàng từ bảng permission hiệu lực (`UserAccess.permissions`). */
export function customerScopesFrom(permissions: UserAccess['permissions']): CustomerScopes {
  return {
    view: permissions['customer.view'],
    edit: permissions['customer.edit'],
    delete: permissions['customer.delete'],
    assign: permissions['customer.assign'],
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

  /**
   * `GET /api/v1/customers?status=NEW,CONTACTED&page=1&pageSize=20` → khách xem được, mới tạo trước;
   * `status` lọc theo bước pipeline (TASK-082).
   */
  @Get()
  @RequirePermission('customer.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: CustomerListQueryDto,
  ): Promise<Paginated<CustomerResponse>> {
    return this.customers.findAll(actorOf(tenantId, req.user), query, customerScopesOf(req.user));
  }

  /**
   * `GET /api/v1/customers/pipeline` → `[{status, count}]` số khách xem được ở từng bước, theo thứ tự
   * pipeline (TASK-082). Khai báo trước `:id` để không bị hiểu là id.
   */
  @Get('pipeline')
  @RequirePermission('customer.view')
  pipeline(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
  ): Promise<{ status: string; count: number }[]> {
    return this.customers.pipeline(actorOf(tenantId, req.user), customerScopesOf(req.user));
  }

  /**
   * `GET /api/v1/customers/dashboard?from&to` → số liệu khách hàng trong phạm vi xem (TASK-085). Khai báo
   * trước `:id`.
   */
  @Get('dashboard')
  @RequirePermission('customer.view')
  dashboard(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: CustomerDashboardQueryDto,
  ): Promise<CustomerDashboard> {
    return this.customers.dashboard(actorOf(tenantId, req.user), query, customerScopesOf(req.user));
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

  /**
   * `POST /api/v1/customers/:id/status` {status, lostReason?, expectedUpdatedAt?} → khách sau khi chuyển
   * bước pipeline (TASK-082). Cần `customer.edit`; sang LOST bắt buộc `lostReason`.
   */
  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('customer.edit')
  changeStatus(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ChangeCustomerStatusDto,
  ): Promise<CustomerResponse> {
    return this.customers.changeStatus(
      actorOf(tenantId, req.user),
      id,
      dto,
      customerScopesOf(req.user),
    );
  }

  /**
   * `POST /api/v1/customers/:id/assign` {agentId, expectedUpdatedAt?} → khách sau khi đổi môi giới phụ
   * trách (TASK-079). Cần `customer.assign` với khách đó và với người nhận.
   */
  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('customer.assign')
  assign(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AssignCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customers.assign(actorOf(tenantId, req.user), id, dto, customerScopesOf(req.user));
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
