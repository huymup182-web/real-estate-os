import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import type { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { insertCustomerActivity } from './customer-activity.record.js';
import type { ActivityType } from './customer-values.js';
import { type CustomerScopes, CustomersService } from './customers.service.js';

/** Cho phép lệch đồng hồ giữa máy người dùng và server khi kiểm `occurredAt` không ở tương lai. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Một hoạt động trên timeline của khách. */
export interface CustomerActivity {
  id: string;
  type: string;
  content: string | null;
  propertyIds: string[] | null;
  metadata: Record<string, unknown>;
  user: { id: string; fullName: string };
  occurredAt: Date;
  createdAt: Date;
}

/** Hoạt động người dùng ghi. */
export interface ActivityInput {
  type: ActivityType;
  content?: string | null;
  propertyIds?: string[] | null;
  occurredAt?: Date;
}

interface ActivityRow {
  id: string;
  type: string;
  content: string | null;
  property_ids: string[] | null;
  metadata: Record<string, unknown>;
  user_id: string;
  full_name: string;
  occurred_at: Date;
  created_at: Date;
}

function toActivity(row: ActivityRow): CustomerActivity {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    propertyIds: row.property_ids,
    metadata: row.metadata,
    user: { id: row.user_id, fullName: row.full_name },
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

const SELECT_ACTIVITY = `SELECT a.id, a.type, a.content, a.property_ids, a.metadata, a.user_id, u.full_name,
         a.occurred_at, a.created_at
    FROM customer_activities a
    JOIN users u ON u.id = a.user_id AND u.tenant_id = a.tenant_id`;

/**
 * Timeline chăm sóc khách (TASK-080 ghi chú, TASK-081 timeline) trên `customer_activities`: chỉ thêm,
 * không sửa, không xoá (docs/database.md mục 4.5). Xem cần xem được khách; ghi cần sửa được khách.
 */
@Injectable()
export class CustomerActivitiesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly customers: CustomersService,
    private readonly properties: PropertiesService,
  ) {}

  /**
   * Ghi hoạt động → 201. Khách ngoài phạm vi xem → 404, ngoài phạm vi sửa → 403. `occurredAt` ở tương lai
   * → 400. BĐS gắn kèm phải là BĐS người ghi xem được, không thì 400 `propertyIds` (không lộ BĐS nào có).
   */
  async create(
    actor: Actor,
    customerId: string,
    input: ActivityInput,
    scopes: CustomerScopes,
    propertyScopes: PropertyScopes,
  ): Promise<CustomerActivity> {
    if (input.occurredAt && input.occurredAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw invalid('occurredAt', 'occurredAt không được ở tương lai');
    }
    for (const propertyId of input.propertyIds ?? []) {
      try {
        await this.properties.assertVisible(actor, propertyId, propertyScopes);
      } catch (error) {
        if (!(error instanceof AppException) || error.code !== ErrorCode.NOT_FOUND) {
          throw error;
        }
        throw invalid('propertyIds', `BĐS ${propertyId} không tồn tại hoặc bạn không xem được`);
      }
    }

    const id = await this.dataSource.transaction(async (manager) => {
      // Khoá dòng khách: không ghi được vào khách đang bị xoá cùng lúc.
      await this.customers.lockForAction(
        manager,
        actor,
        customerId,
        scopes,
        scopes.edit,
        'Không có quyền ghi hoạt động cho khách hàng này',
      );
      return insertCustomerActivity(manager, {
        tenantId: actor.tenantId,
        customerId,
        userId: actor.userId,
        type: input.type,
        content: input.content ?? null,
        propertyIds: input.propertyIds ?? null,
        occurredAt: input.occurredAt ?? null,
      });
    });
    const [row] = (await this.dataSource.query(
      `${SELECT_ACTIVITY} WHERE a.tenant_id = $1 AND a.id = $2`,
      [actor.tenantId, id],
    )) as ActivityRow[];
    if (!row) {
      throw new AppException(ErrorCode.INTERNAL_ERROR);
    }
    return toActivity(row);
  }

  /**
   * Timeline của khách, xảy ra gần đây trước, phân trang; `types` lọc theo loại. Khách ngoài phạm vi
   * xem → 404.
   */
  async findAll(
    actor: Actor,
    customerId: string,
    query: PaginationQueryDto,
    scopes: CustomerScopes,
    types?: readonly string[],
  ): Promise<Paginated<CustomerActivity>> {
    await this.customers.findOne(actor, customerId, scopes);
    const typeFilter = types && types.length > 0 ? types : null;
    const [count] = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM customer_activities a
        WHERE a.tenant_id = $1 AND a.customer_id = $2
          AND ($3::text[] IS NULL OR a.type = ANY($3::text[]))`,
      [actor.tenantId, customerId, typeFilter],
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `${SELECT_ACTIVITY}
        WHERE a.tenant_id = $1 AND a.customer_id = $2
          AND ($3::text[] IS NULL OR a.type = ANY($3::text[]))
        ORDER BY a.occurred_at DESC, a.created_at DESC, a.id DESC
        OFFSET $4 LIMIT $5`,
      [actor.tenantId, customerId, typeFilter, query.offset, query.pageSize],
    )) as ActivityRow[];
    return new Paginated(rows.map(toActivity), query.page, query.pageSize, count?.total ?? 0);
  }
}

function invalid(field: string, message: string): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, [{ field, message }]);
}
