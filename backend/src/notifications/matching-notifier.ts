import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { PermissionService } from '../auth/permission.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { CLOSED_CUSTOMER_STATUSES } from '../customers/customer-values.js';
import { customerScopesFrom } from '../customers/customers.controller.js';
import {
  type CustomerMatch,
  MatchingService,
  MAX_MATCH_LIMIT,
} from '../matching/matching.service.js';
import { scopesFrom } from '../properties/properties.controller.js';
import { type PropertyCreatedEvent, PropertyEvents } from '../properties/property-events.js';
import { NOTIFICATION_BODY_MAX } from './notification-values.js';
import { NotificationsService } from './notifications.service.js';

export const MATCHED_PROPERTY_TITLE = 'BĐS mới phù hợp với khách của bạn';
/** Số khách nêu tên trong nội dung thông báo; còn lại ghi "và N khách khác". */
export const MATCHED_NAMES_IN_BODY = 3;

/**
 * Thông báo matching (TASK-096): khi BĐS được tạo, môi giới phụ trách khách (`customers.agent_id`) mà BĐS
 * phù hợp (điểm ≥ MIN_MATCH_SCORE, luật TASK-086..087) nhận một thông báo MATCHED_PROPERTY liệt kê các
 * khách đó. Ghép theo đúng quyền xem BĐS và khách của chính môi giới; mỗi môi giới chỉ được báo về khách
 * mình phụ trách, kể cả người tạo BĐS.
 */
@Injectable()
export class MatchingNotifier implements OnModuleInit {
  private readonly logger = new Logger(MatchingNotifier.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: PropertyEvents,
    private readonly matching: MatchingService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.events.onCreated((event) => this.handle(event).then(() => undefined));
  }

  /** Trả số môi giới được thông báo. */
  async handle(event: PropertyCreatedEvent): Promise<number> {
    const [property] = (await this.dataSource.query(
      `SELECT code, title, transaction_type FROM properties
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [event.tenantId, event.propertyId],
    )) as { code: string; title: string; transaction_type: string }[];
    if (!property) {
      return 0;
    }

    // Môi giới đang hoạt động có khách đang mở với nhu cầu cùng loại giao dịch: chỉ họ mới có thể khớp.
    const agents = (await this.dataSource.query(
      `SELECT DISTINCT c.agent_id
         FROM customers c
         JOIN customer_preferences cp ON cp.tenant_id = c.tenant_id AND cp.customer_id = c.id
                                     AND cp.deleted_at IS NULL AND cp.is_active
         JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.agent_id
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.status <> ALL($2::text[])
          AND cp.transaction_type = $3 AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
        ORDER BY c.agent_id`,
      [event.tenantId, [...CLOSED_CUSTOMER_STATUSES], property.transaction_type],
    )) as { agent_id: string }[];

    let notified = 0;
    for (const { agent_id: agentId } of agents) {
      const matches = await this.matchesOf(event, agentId);
      if (matches.length === 0) {
        continue;
      }
      await this.notifications.notify({
        tenantId: event.tenantId,
        userIds: [agentId],
        type: 'MATCHED_PROPERTY',
        title: MATCHED_PROPERTY_TITLE,
        body: matchBody(property, matches),
        data: {
          propertyId: event.propertyId,
          matchCount: matches.length,
          customers: matches
            .slice(0, MATCHED_CUSTOMERS_IN_DATA)
            .map((match) => ({ customerId: match.customer.id, score: match.score })),
        },
      });
      notified += 1;
    }
    return notified;
  }

  /** Khách do `agentId` phụ trách mà BĐS phù hợp, theo quyền xem của chính người đó. */
  private async matchesOf(event: PropertyCreatedEvent, agentId: string): Promise<CustomerMatch[]> {
    const { permissions } = await this.permissions.getUserAccess(agentId);
    const customerScopes = customerScopesFrom(permissions);
    const propertyScopes = scopesFrom(permissions);
    if (!customerScopes.view || !propertyScopes.view) {
      return [];
    }
    try {
      const matches = await this.matching.customersForProperty(
        { tenantId: event.tenantId, userId: agentId },
        event.propertyId,
        { property: propertyScopes, customer: customerScopes },
        { limit: MAX_MATCH_LIMIT },
      );
      return matches.filter((match) => match.customer.agentId === agentId);
    } catch (error) {
      // 404: môi giới không xem được BĐS này. Lỗi khác chỉ bỏ qua môi giới đó, vẫn báo người khác.
      if (!(error instanceof AppException && error.code === ErrorCode.NOT_FOUND)) {
        this.logger.warn('Không ghép được BĐS mới với khách của môi giới', {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return [];
    }
  }
}

/** Số khách ghi trong `data` (giữ JSON dưới NOTIFICATION_DATA_MAX). */
const MATCHED_CUSTOMERS_IN_DATA = 20;

/** Vd `BDS-000123 · Nhà phố. Phù hợp: Anh Minh (92%), Chị Lan (80%) và 2 khách khác`. */
function matchBody(property: { code: string; title: string }, matches: CustomerMatch[]): string {
  const named = matches
    .slice(0, MATCHED_NAMES_IN_BODY)
    .map((match) => `${match.customer.fullName} (${match.score}%)`)
    .join(', ');
  const rest = matches.length - MATCHED_NAMES_IN_BODY;
  const more = rest > 0 ? ` và ${rest} khách khác` : '';
  return `${property.code} · ${property.title}. Phù hợp: ${named}${more}`.slice(
    0,
    NOTIFICATION_BODY_MAX,
  );
}
