import { Controller, Get, Param, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { customerScopesOf } from '../customers/customers.controller.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import { MatchQueryDto } from './dto/match-query.dto.js';
import { type CustomerMatch, MatchingService, type PropertyMatch } from './matching.service.js';

/**
 * API matching (TASK-090). Route cần quyền xem của đối tượng chính; đối tượng được gợi ý lọc theo phạm vi
 * xem còn lại của user (không có quyền đó → danh sách rỗng).
 */
@Controller()
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  /**
   * `GET /api/v1/properties/:id/matching-customers?minScore&limit` → khách phù hợp với BĐS, điểm cao trước.
   * BĐS ngoài phạm vi `property.view` → 404.
   */
  @Get('properties/:id/matching-customers')
  @RequirePermission('property.view')
  customersForProperty(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: MatchQueryDto,
  ): Promise<CustomerMatch[]> {
    return this.matching.customersForProperty(
      actorOf(tenantId, req.user),
      id,
      { property: scopesOf(req.user), customer: customerScopesOf(req.user) },
      query,
    );
  }

  /**
   * `GET /api/v1/customers/:id/matching-properties?minScore&limit` → BĐS phù hợp với khách, điểm cao trước.
   * Khách ngoài phạm vi `customer.view` → 404.
   */
  @Get('customers/:id/matching-properties')
  @RequirePermission('customer.view')
  propertiesForCustomer(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: MatchQueryDto,
  ): Promise<PropertyMatch[]> {
    return this.matching.propertiesForCustomer(
      actorOf(tenantId, req.user),
      id,
      { property: scopesOf(req.user), customer: customerScopesOf(req.user) },
      query,
    );
  }
}
