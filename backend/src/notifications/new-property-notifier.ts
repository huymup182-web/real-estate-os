import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { DataSource } from 'typeorm';

import { PermissionService } from '../auth/permission.service.js';
import { scopesFrom } from '../properties/properties.controller.js';
import { PropertiesService } from '../properties/properties.service.js';
import { type PropertyCreatedEvent, PropertyEvents } from '../properties/property-events.js';
import { PropertySearchQueryDto } from '../search/property-search-query.dto.js';
import { normalizeSearchFilters } from '../search/search-filters.js';
import { NOTIFICATION_BODY_MAX } from './notification-values.js';
import { NotificationsService } from './notifications.service.js';

interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string;
  filters: Record<string, unknown>;
}

export const NEW_PROPERTY_TITLE = 'BĐS mới khớp tìm kiếm đã lưu';

/**
 * Thông báo BĐS mới (TASK-095): khi BĐS được tạo, mỗi người có tìm kiếm đã lưu bật `notify` mà BĐS
 * khớp bộ lọc (theo quyền xem BĐS hiện tại của họ) nhận một thông báo NEW_PROPERTY, dù khớp nhiều
 * tìm kiếm. Người tạo BĐS không nhận. Tìm kiếm khớp được ghi `last_notified_at`.
 */
@Injectable()
export class NewPropertyNotifier implements OnModuleInit {
  private readonly logger = new Logger(NewPropertyNotifier.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: PropertyEvents,
    private readonly properties: PropertiesService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.events.onCreated((event) => this.handle(event).then(() => undefined));
  }

  /** Trả số người được thông báo. */
  async handle(event: PropertyCreatedEvent): Promise<number> {
    const [property] = (await this.dataSource.query(
      `SELECT code, title FROM properties WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [event.tenantId, event.propertyId],
    )) as { code: string; title: string }[];
    if (!property) {
      return 0;
    }

    const searches = (await this.dataSource.query(
      `SELECT s.id, s.user_id, s.name, s.filters
         FROM saved_searches s
         JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
        WHERE s.tenant_id = $1 AND s.notify AND s.deleted_at IS NULL AND s.user_id <> $2
          AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
        ORDER BY s.user_id, s.created_at`,
      [event.tenantId, event.createdBy],
    )) as SavedSearchRow[];
    const byUser = new Map<string, SavedSearchRow[]>();
    for (const search of searches) {
      byUser.set(search.user_id, [...(byUser.get(search.user_id) ?? []), search]);
    }

    let notified = 0;
    for (const [userId, userSearches] of byUser) {
      const matched = await this.matching(event, userId, userSearches);
      if (matched.length === 0) {
        continue;
      }
      const names = matched.map((search) => `"${search.name}"`).join(', ');
      await this.notifications.notify({
        tenantId: event.tenantId,
        userIds: [userId],
        type: 'NEW_PROPERTY',
        title: NEW_PROPERTY_TITLE,
        body: `${property.code} · ${property.title}. Khớp: ${names}`.slice(
          0,
          NOTIFICATION_BODY_MAX,
        ),
        data: { propertyId: event.propertyId, savedSearchIds: matched.map((search) => search.id) },
      });
      await this.dataSource.query(
        `UPDATE saved_searches SET last_notified_at = now() WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [event.tenantId, matched.map((search) => search.id)],
      );
      notified += 1;
    }
    return notified;
  }

  /** Tìm kiếm của người dùng mà BĐS khớp; không có quyền xem BĐS thì không khớp gì. */
  private async matching(
    event: PropertyCreatedEvent,
    userId: string,
    searches: SavedSearchRow[],
  ): Promise<SavedSearchRow[]> {
    const scopes = scopesFrom((await this.permissions.getUserAccess(userId)).permissions);
    if (!scopes.view) {
      return [];
    }
    const actor = { tenantId: event.tenantId, userId };
    const matched: SavedSearchRow[] = [];
    for (const search of searches) {
      let query: PropertySearchQueryDto;
      try {
        // Kiểm lại bộ lọc phòng khi schema tìm kiếm đổi sau lúc lưu; hỏng thì bỏ qua tìm kiếm đó.
        query = plainToInstance(PropertySearchQueryDto, normalizeSearchFilters(search.filters));
      } catch {
        this.logger.warn('Bỏ qua tìm kiếm đã lưu có bộ lọc không còn hợp lệ', {
          savedSearchId: search.id,
        });
        continue;
      }
      if (await this.properties.matchesSearch(actor, event.propertyId, query, scopes)) {
        matched.push(search);
      }
    }
    return matched;
  }
}
