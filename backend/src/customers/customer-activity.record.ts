import type { EntityManager } from 'typeorm';

import type { ActivityType } from './customer-values.js';

/** Một dòng mới của timeline khách. */
export interface NewCustomerActivity {
  tenantId: string;
  customerId: string;
  userId: string;
  type: ActivityType;
  content?: string | null;
  propertyIds?: string[] | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date | null;
}

/**
 * Thêm một dòng vào `customer_activities` (chỉ thêm, không sửa) trong transaction của thao tác, trả về id.
 * Dùng chung cho hoạt động người dùng ghi (TASK-080, TASK-081) và hệ thống ghi (giao khách, đổi trạng thái).
 */
export async function insertCustomerActivity(
  manager: EntityManager,
  activity: NewCustomerActivity,
): Promise<string> {
  const [row] = (await manager.query(
    `INSERT INTO customer_activities
       (tenant_id, customer_id, user_id, type, content, property_ids, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::jsonb, COALESCE($8::timestamptz, now()))
     RETURNING id`,
    [
      activity.tenantId,
      activity.customerId,
      activity.userId,
      activity.type,
      activity.content ?? null,
      activity.propertyIds ?? null,
      JSON.stringify(activity.metadata ?? {}),
      activity.occurredAt ?? null,
    ],
  )) as { id: string }[];
  if (!row) {
    throw new Error('Không ghi được hoạt động của khách');
  }
  return row.id;
}
