import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import type { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import type { Actor } from '../properties/properties.service.js';
import { type CustomerScopes, CustomersService } from './customers.service.js';
import type { CreateCustomerNoteDto } from './dto/create-customer-note.dto.js';

/** Cho phép lệch đồng hồ giữa máy người dùng và server khi kiểm `occurredAt` không ở tương lai. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Một ghi chú của khách. */
export interface CustomerNote {
  id: string;
  content: string;
  user: { id: string; fullName: string };
  occurredAt: Date;
  createdAt: Date;
}

interface NoteRow {
  id: string;
  content: string;
  user_id: string;
  full_name: string;
  occurred_at: Date;
  created_at: Date;
}

function toNote(row: NoteRow): CustomerNote {
  return {
    id: row.id,
    content: row.content,
    user: { id: row.user_id, fullName: row.full_name },
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

/**
 * Ghi chú khách hàng (TASK-080): dòng `type = 'NOTE'` trong `customer_activities` (timeline của khách,
 * chỉ thêm, không sửa, không xoá; docs/database.md mục 4.5). Xem cần xem được khách; thêm cần sửa được khách.
 */
@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly customers: CustomersService,
  ) {}

  /** Thêm ghi chú → 201. Khách ngoài phạm vi xem → 404, ngoài phạm vi sửa → 403. */
  async create(
    actor: Actor,
    customerId: string,
    dto: CreateCustomerNoteDto,
    scopes: CustomerScopes,
  ): Promise<CustomerNote> {
    if (dto.occurredAt && dto.occurredAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, [
        { field: 'occurredAt', message: 'occurredAt không được ở tương lai' },
      ]);
    }
    return this.dataSource.transaction(async (manager) => {
      // Khoá dòng khách: không thêm được ghi chú cho khách đang bị xoá cùng lúc.
      await this.customers.lockForAction(
        manager,
        actor,
        customerId,
        scopes,
        scopes.edit,
        'Không có quyền ghi chú cho khách hàng này',
      );
      const [row] = (await manager.query(
        `WITH note AS (
           INSERT INTO customer_activities (tenant_id, customer_id, user_id, type, content, occurred_at)
           VALUES ($1, $2, $3, 'NOTE', $4, COALESCE($5::timestamptz, now()))
           RETURNING id, content, user_id, occurred_at, created_at
         )
         SELECT note.*, u.full_name FROM note JOIN users u ON u.id = note.user_id`,
        [actor.tenantId, customerId, actor.userId, dto.content, dto.occurredAt ?? null],
      )) as NoteRow[];
      if (!row) {
        throw new AppException(ErrorCode.INTERNAL_ERROR);
      }
      return toNote(row);
    });
  }

  /** Ghi chú của khách, xảy ra gần đây trước, phân trang. Khách ngoài phạm vi xem → 404. */
  async findAll(
    actor: Actor,
    customerId: string,
    query: PaginationQueryDto,
    scopes: CustomerScopes,
  ): Promise<Paginated<CustomerNote>> {
    await this.customers.findOne(actor, customerId, scopes);
    const [count] = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM customer_activities
        WHERE tenant_id = $1 AND customer_id = $2 AND type = 'NOTE'`,
      [actor.tenantId, customerId],
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `SELECT a.id, a.content, a.user_id, u.full_name, a.occurred_at, a.created_at
         FROM customer_activities a
         JOIN users u ON u.id = a.user_id AND u.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.customer_id = $2 AND a.type = 'NOTE'
        ORDER BY a.occurred_at DESC, a.created_at DESC, a.id DESC
        OFFSET $3 LIMIT $4`,
      [actor.tenantId, customerId, query.offset, query.pageSize],
    )) as NoteRow[];
    return new Paginated(rows.map(toNote), query.page, query.pageSize, count?.total ?? 0);
  }
}
