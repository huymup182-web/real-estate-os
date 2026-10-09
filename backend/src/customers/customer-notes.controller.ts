import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import { type CustomerNote, CustomerNotesService } from './customer-notes.service.js';
import { customerScopesOf } from './customers.controller.js';
import { CreateCustomerNoteDto } from './dto/create-customer-note.dto.js';

/** Ghi chú khách hàng (TASK-080): `/api/v1/customers/:customerId/notes`. Ghi chú không sửa, không xoá. */
@Controller('customers/:customerId/notes')
export class CustomerNotesController {
  constructor(private readonly notes: CustomerNotesService) {}

  /** `GET ?page&pageSize` → ghi chú của khách, xảy ra gần đây trước. Cần `customer.view`. */
  @Get()
  @RequirePermission('customer.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('customerId', ParseUuidPipe) customerId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<CustomerNote>> {
    return this.notes.findAll(
      actorOf(tenantId, req.user),
      customerId,
      query,
      customerScopesOf(req.user),
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
  ): Promise<CustomerNote> {
    return this.notes.create(
      actorOf(tenantId, req.user),
      customerId,
      dto,
      customerScopesOf(req.user),
    );
  }
}
