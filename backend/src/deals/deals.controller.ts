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
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { customerScopesOf } from '../customers/customers.controller.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { type DealResponse, type DealScopes, DealsService } from './deals.service.js';
import {
  ChangeDealStageDto,
  CreateDealDto,
  DealListQueryDto,
  UpdateDealDto,
} from './dto/deal.dto.js';

function dealScopesOf(user: RequestUser): DealScopes {
  return { view: user.permissions['deal.view'], manage: user.permissions['deal.manage'] };
}

/** Giao dịch giữa khách và BĐS (TASK-110). */
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  /** `POST /api/v1/deals` {customerId, propertyId, dealPrice?, depositAmount?, depositAt?, notes?} → 201. */
  @Post()
  @RequirePermission('deal.manage')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateDealDto,
  ): Promise<DealResponse> {
    return this.deals.create(
      actorOf(tenantId, req.user),
      dto,
      { customers: customerScopesOf(req.user), properties: scopesOf(req.user) },
      dealScopesOf(req.user),
    );
  }

  /** `GET /api/v1/deals?stage&customerId&propertyId&page&pageSize` → giao dịch, mới tạo trước. */
  @Get()
  @RequirePermission('deal.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: DealListQueryDto,
  ): Promise<Paginated<DealResponse>> {
    return this.deals.findAll(actorOf(tenantId, req.user), query, dealScopesOf(req.user));
  }

  /** `GET /api/v1/deals/:id`; không xem được → 404. */
  @Get(':id')
  @RequirePermission('deal.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<DealResponse> {
    return this.deals.findOne(actorOf(tenantId, req.user), id, dealScopesOf(req.user));
  }

  /** `PATCH /api/v1/deals/:id` {dealPrice?, depositAmount?, depositAt?, notes?, expectedUpdatedAt?}. */
  @Patch(':id')
  @RequirePermission('deal.manage')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateDealDto,
  ): Promise<DealResponse> {
    return this.deals.update(actorOf(tenantId, req.user), id, dto, dealScopesOf(req.user));
  }

  /** `POST /api/v1/deals/:id/stage` {stage, expectedUpdatedAt?} → giao dịch sau khi chuyển bước. */
  @Post(':id/stage')
  @HttpCode(200)
  @RequirePermission('deal.manage')
  changeStage(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ChangeDealStageDto,
  ): Promise<DealResponse> {
    return this.deals.changeStage(actorOf(tenantId, req.user), id, dto, dealScopesOf(req.user));
  }

  /** `DELETE /api/v1/deals/:id` → 204, xoá mềm. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('deal.manage')
  remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    return this.deals.remove(actorOf(tenantId, req.user), id, dealScopesOf(req.user));
  }
}
