import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository, type SelectQueryBuilder } from 'typeorm';

import { type AuditChanges, AuditService } from '../audit/audit.service.js';
import type { PermissionScope } from '../auth/permission.service.js';
import { scopeCondition } from '../auth/record-scope.js';
import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import { insertCustomerActivity } from '../customers/customer-activity.record.js';
import { CustomersService, type CustomerScopes } from '../customers/customers.service.js';
import { TenantRepository, type TenantWritable } from '../database/tenant.repository.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { Appointment } from './appointment.entity.js';
import { OUTCOME_REQUIRED, STATUSES_AFTER_START } from './appointment-values.js';
import {
  type AppointmentListQueryDto,
  type ChangeAppointmentStatusDto,
  type CreateAppointmentDto,
  EDITABLE_APPOINTMENT_FIELDS,
  type UpdateAppointmentDto,
} from './dto/appointment.dto.js';

/** Phạm vi quyền lịch hẹn của user. Không có key = không có quyền. */
export interface AppointmentScopes {
  view: PermissionScope | undefined;
  manage: PermissionScope | undefined;
}

/** Quyền của user với khách và BĐS, để kiểm khách/BĐS được hẹn. */
export interface RelatedScopes {
  customers: CustomerScopes;
  properties: PropertyScopes;
}

/** Lịch hẹn trả cho client, kèm tên khách và BĐS để hiện lịch. */
export interface AppointmentResponse {
  id: string;
  customer: { id: string; fullName: string };
  property: { id: string; code: string; title: string };
  agentId: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  location: string | null;
  notes: string | null;
  status: string;
  outcome: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NamesRow {
  a_id: string;
  customer_name: string;
  property_code: string;
  property_title: string;
}

/** Cột xét phạm vi của lịch hẹn: môi giới của lịch và người tạo. */
const APPOINTMENT_SCOPE_COLUMNS = { agent: 'a.agent_id', creator: 'a.created_by' };

/** Cho phép lệch đồng hồ giữa máy người dùng và server khi kiểm lịch không ở quá khứ. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Lịch hẹn dẫn khách xem BĐS (TASK-083). Quyền `appointment.view` / `appointment.manage`
 * (phase0/04-RBAC.md), phạm vi xét theo môi giới của lịch hoặc người tạo.
 */
@Injectable()
export class AppointmentsService {
  private readonly appointments: TenantRepository<Appointment>;

  constructor(
    @InjectRepository(Appointment) repository: Repository<Appointment>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly properties: PropertiesService,
  ) {
    this.appointments = new TenantRepository(repository);
  }

  /**
   * Tạo lịch hẹn → 201: môi giới là người tạo, trạng thái SCHEDULED. Khách và BĐS phải là khách/BĐS người
   * tạo xem được (không thì 400 `customerId`/`propertyId`); giờ hẹn không ở quá khứ.
   */
  async create(
    actor: Actor,
    dto: CreateAppointmentDto,
    related: RelatedScopes,
    scopes: AppointmentScopes,
  ): Promise<AppointmentResponse> {
    assertNotPast(dto.scheduledAt);
    await this.assertCustomer(actor, dto.customerId, related.customers);
    await this.assertProperty(actor, dto.propertyId, related.properties);

    const appointment = await this.dataSource.transaction(async (manager) => {
      const created = await this.appointments.withManager(manager).create(actor.tenantId, {
        customerId: dto.customerId,
        propertyId: dto.propertyId,
        agentId: actor.userId,
        scheduledAt: dto.scheduledAt,
        durationMinutes: dto.durationMinutes ?? null,
        location: dto.location ?? null,
        notes: dto.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await this.record(manager, actor, created.id, 'appointment.create');
      return created;
    });
    return this.findOne(actor, appointment.id, scopes);
  }

  /** Chi tiết lịch hẹn. Ngoài phạm vi `appointment.view`, đã xoá, công ty khác → 404. */
  async findOne(actor: Actor, id: string, scopes: AppointmentScopes): Promise<AppointmentResponse> {
    const [item] = await this.withNames(
      this.visible(actor, scopes, (query) => query.andWhere('a.id = :id', { id })),
    );
    if (!item) {
      throw notFound();
    }
    return item;
  }

  /**
   * Lịch hẹn trong phạm vi `appointment.view`, giờ hẹn sớm trước, phân trang. Lọc `from` (gồm), `to`
   * (không gồm), `customerId`, `propertyId`; `from` sau `to` → 400.
   */
  async findAll(
    actor: Actor,
    query: AppointmentListQueryDto,
    scopes: AppointmentScopes,
  ): Promise<Paginated<AppointmentResponse>> {
    if (query.from && query.to && query.from.getTime() >= query.to.getTime()) {
      throw invalid([{ field: 'to', message: 'to phải sau from' }]);
    }
    const base = this.visible(actor, scopes, (builder) => {
      let filtered = builder;
      if (query.from) {
        filtered = filtered.andWhere('a.scheduledAt >= :from', { from: query.from });
      }
      if (query.to) {
        filtered = filtered.andWhere('a.scheduledAt < :to', { to: query.to });
      }
      if (query.customerId) {
        filtered = filtered.andWhere('a.customerId = :customerId', {
          customerId: query.customerId,
        });
      }
      if (query.propertyId) {
        filtered = filtered.andWhere('a.propertyId = :propertyId', {
          propertyId: query.propertyId,
        });
      }
      if (query.status) {
        filtered = filtered.andWhere('a.status IN (:...statuses)', { statuses: query.status });
      }
      return filtered;
    });
    const total = await base.clone().getCount();
    const items = await this.withNames(
      base
        .orderBy('a.scheduledAt', 'ASC')
        .addOrderBy('a.id', 'ASC')
        .offset(query.offset)
        .limit(query.pageSize),
    );
    return new Paginated(items, query.page, query.pageSize, total);
  }

  /**
   * Sửa lịch hẹn: chỉ đổi trường được gửi, trong transaction có khoá dòng. Ngoài phạm vi xem → 404,
   * ngoài phạm vi `appointment.manage` → 403, `expectedUpdatedAt` lệch → 409. Đổi BĐS thì BĐS mới phải
   * xem được; đổi giờ thì không ở quá khứ.
   */
  async update(
    actor: Actor,
    id: string,
    dto: UpdateAppointmentDto,
    related: RelatedScopes,
    scopes: AppointmentScopes,
  ): Promise<AppointmentResponse> {
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_APPOINTMENT_FIELDS) {
      if (dto[field] !== undefined) {
        patch[field] = dto[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      throw invalid([{ message: 'Cần gửi ít nhất một trường để cập nhật' }]);
    }

    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockForManage(manager, actor, id, scopes);
      if (
        dto.expectedUpdatedAt &&
        dto.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()
      ) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'Lịch hẹn đã được người khác cập nhật, vui lòng tải lại rồi thao tác lại',
        );
      }
      const rescheduled =
        dto.scheduledAt !== undefined &&
        dto.scheduledAt.getTime() !== current.scheduledAt.getTime();
      if (rescheduled && dto.scheduledAt) {
        assertNotPast(dto.scheduledAt);
      }
      if (dto.propertyId && dto.propertyId !== current.propertyId) {
        await this.assertProperty(actor, dto.propertyId, related.properties);
      }
      await this.appointments.withManager(manager).update(actor.tenantId, id, {
        ...patch,
        updatedBy: actor.userId,
      } as TenantWritable<Appointment>);
      if (rescheduled) {
        // Đổi giờ hẹn thì nhắc lại theo giờ mới (TASK-097).
        await manager.query(
          `UPDATE appointments SET reminder_sent_at = NULL WHERE tenant_id = $1 AND id = $2`,
          [actor.tenantId, id],
        );
      }
      const changes = diff(current, patch);
      if (changes) {
        await this.record(manager, actor, id, 'appointment.update', changes);
      }
    });
    return this.findOne(actor, id, scopes);
  }

  /**
   * Đổi trạng thái lịch hẹn / ghi kết quả buổi xem (TASK-084). Cần `appointment.manage` (404/403 như khi sửa).
   * - `outcome` chỉ đi với COMPLETED (gửi kèm trạng thái khác → 400); rời COMPLETED thì xoá kết quả.
   * - COMPLETED, NO_SHOW chỉ đặt được khi đã tới giờ hẹn (→ 422). Các trạng thái chuyển qua lại tự do
   *   (mở lại lịch đã huỷ được), như pipeline khách.
   * - Không đổi gì (cùng trạng thái, cùng kết quả) thì không ghi gì.
   * - Ghi `appointment.change_status` vào `audit_logs`; COMPLETED, NO_SHOW ghi thêm một dòng VIEWING lên
   *   timeline của khách (BĐS của lịch, `metadata {appointmentId, status, outcome}`).
   */
  async changeStatus(
    actor: Actor,
    id: string,
    dto: ChangeAppointmentStatusDto,
    scopes: AppointmentScopes,
  ): Promise<AppointmentResponse> {
    if (dto.status !== 'COMPLETED' && dto.outcome !== undefined) {
      throw invalid([{ field: 'outcome', message: 'outcome chỉ gửi khi status là COMPLETED' }]);
    }
    if (dto.status === 'COMPLETED' && OUTCOME_REQUIRED && dto.outcome === undefined) {
      throw invalid([{ field: 'outcome', message: 'Cần ghi kết quả buổi xem' }]);
    }
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockForManage(manager, actor, id, scopes);
      if (
        dto.expectedUpdatedAt &&
        dto.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()
      ) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'Lịch hẹn đã được người khác cập nhật, vui lòng tải lại rồi thao tác lại',
        );
      }
      const outcome = dto.status === 'COMPLETED' ? (dto.outcome ?? null) : null;
      if (current.status === dto.status && current.outcome === outcome) {
        return;
      }
      if (
        STATUSES_AFTER_START.includes(dto.status) &&
        current.scheduledAt.getTime() > Date.now() + CLOCK_SKEW_MS
      ) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          'Chưa tới giờ hẹn, chưa đánh dấu đã xem hoặc khách không đến được',
        );
      }
      await this.appointments.withManager(manager).update(actor.tenantId, id, {
        status: dto.status,
        outcome,
        updatedBy: actor.userId,
      });
      const changes = diff(current, { status: dto.status, outcome });
      await this.record(manager, actor, id, 'appointment.change_status', changes);
      if (STATUSES_AFTER_START.includes(dto.status)) {
        await insertCustomerActivity(manager, {
          tenantId: actor.tenantId,
          customerId: current.customerId,
          userId: actor.userId,
          type: 'VIEWING',
          propertyIds: [current.propertyId],
          metadata: { appointmentId: id, status: dto.status, outcome },
        });
      }
    });
    return this.findOne(actor, id, scopes);
  }

  /** Xoá mềm lịch hẹn → 204. Ngoài phạm vi xem → 404, ngoài phạm vi `appointment.manage` → 403. */
  async remove(actor: Actor, id: string, scopes: AppointmentScopes): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockForManage(manager, actor, id, scopes);
      const appointments = this.appointments.withManager(manager);
      await appointments.update(actor.tenantId, id, { updatedBy: actor.userId });
      await appointments.softDelete(actor.tenantId, id);
      await this.record(manager, actor, id, 'appointment.delete');
    });
  }

  /** Lịch hẹn trong phạm vi xem; `build` thêm điều kiện bằng andWhere. */
  private visible(
    actor: Actor,
    scopes: AppointmentScopes,
    build: (query: SelectQueryBuilder<Appointment>) => SelectQueryBuilder<Appointment>,
  ): SelectQueryBuilder<Appointment> {
    return this.appointments
      .createQueryBuilder(actor.tenantId, 'a', (query) =>
        build(query.where(this.scopeOrFalse(scopes.view))),
      )
      .setParameter('scopeUserId', actor.userId);
  }

  /** Chạy truy vấn lịch hẹn, kèm tên khách và mã, tiêu đề BĐS (kể cả khách/BĐS đã xoá, để giữ lịch sử). */
  private async withNames(query: SelectQueryBuilder<Appointment>): Promise<AppointmentResponse[]> {
    const { entities, raw } = await query
      .innerJoin('customers', 'cu', 'cu.id = a.customer_id AND cu.tenant_id = a.tenant_id')
      .innerJoin('properties', 'pr', 'pr.id = a.property_id AND pr.tenant_id = a.tenant_id')
      .addSelect('cu.full_name', 'customer_name')
      .addSelect('pr.code', 'property_code')
      .addSelect('pr.title', 'property_title')
      .getRawAndEntities<NamesRow>();
    const names = new Map(raw.map((row) => [row.a_id, row]));
    return entities.map((appointment) => {
      const row = names.get(appointment.id);
      return {
        id: appointment.id,
        customer: { id: appointment.customerId, fullName: row?.customer_name ?? '' },
        property: {
          id: appointment.propertyId,
          code: row?.property_code ?? '',
          title: row?.property_title ?? '',
        },
        agentId: appointment.agentId,
        scheduledAt: appointment.scheduledAt,
        durationMinutes: appointment.durationMinutes,
        location: appointment.location,
        notes: appointment.notes,
        status: appointment.status,
        outcome: appointment.outcome,
        createdBy: appointment.createdBy,
        updatedBy: appointment.updatedBy,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
      };
    });
  }

  /** Khoá dòng (FOR UPDATE) rồi kiểm quyền: ngoài phạm vi xem → 404, ngoài phạm vi quản lý → 403. */
  private async lockForManage(
    manager: EntityManager,
    actor: Actor,
    id: string,
    scopes: AppointmentScopes,
  ): Promise<Appointment> {
    const { entities, raw } = await this.appointments
      .withManager(manager)
      .createQueryBuilder(actor.tenantId, 'a', (query) => query.where('a.id = :id', { id }))
      .addSelect(`(${this.scopeOrFalse(scopes.view)})`, 'in_view')
      .addSelect(`(${this.scopeOrFalse(scopes.manage)})`, 'in_action')
      .setParameter('scopeUserId', actor.userId)
      .setLock('pessimistic_write')
      .getRawAndEntities<{ in_view: boolean; in_action: boolean }>();
    const current = entities[0];
    if (!current || raw[0]?.in_view !== true) {
      throw notFound();
    }
    if (raw[0].in_action !== true) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Không có quyền thay đổi lịch hẹn này');
    }
    return current;
  }

  private async assertCustomer(actor: Actor, customerId: string, scopes: CustomerScopes) {
    try {
      await this.customers.findOne(actor, customerId, scopes);
    } catch (error) {
      throw asFieldError(error, 'customerId', 'Khách hàng không tồn tại hoặc bạn không xem được');
    }
  }

  private async assertProperty(actor: Actor, propertyId: string, scopes: PropertyScopes) {
    try {
      await this.properties.assertVisible(actor, propertyId, scopes);
    } catch (error) {
      throw asFieldError(error, 'propertyId', 'BĐS không tồn tại hoặc bạn không xem được');
    }
  }

  private record(
    manager: EntityManager,
    actor: Actor,
    appointmentId: string,
    action: `appointment.${string}`,
    changes: AuditChanges | null = null,
  ): Promise<void> {
    return this.audit.record(manager, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action,
      entityType: 'appointment',
      entityId: appointmentId,
      changes,
    });
  }

  /** Điều kiện phạm vi, hoặc FALSE khi user không có quyền đó. */
  private scopeOrFalse(scope: PermissionScope | undefined): string {
    return scope ? scopeCondition(scope, APPOINTMENT_SCOPE_COLUMNS) : 'FALSE';
  }
}

function assertNotPast(scheduledAt: Date): void {
  if (scheduledAt.getTime() < Date.now() - CLOCK_SKEW_MS) {
    throw invalid([{ field: 'scheduledAt', message: 'Không đặt lịch hẹn vào thời điểm đã qua' }]);
  }
}

/** Khách/BĐS không xem được (404) → lỗi dữ liệu của trường đó; lỗi khác giữ nguyên. */
function asFieldError(error: unknown, field: string, message: string): unknown {
  if (error instanceof AppException && error.code === ErrorCode.NOT_FOUND) {
    return invalid([{ field, message }]);
  }
  return error;
}

/** `{ field: [cũ, mới] }` cho các trường thật sự đổi giá trị; không đổi gì → null. */
function diff(current: Appointment, patch: Record<string, unknown>): AuditChanges | null {
  const changes: AuditChanges = {};
  for (const [field, next] of Object.entries(patch)) {
    const previous = (current as unknown as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next ?? null)) {
      changes[field] = [previous, next ?? null];
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function notFound(): AppException {
  return new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy lịch hẹn');
}

function invalid(details: ErrorDetail[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
}
