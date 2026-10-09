import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import type { AuditChanges } from '../audit/audit.service.js';
import { AppException, type ErrorDetail } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { TenantRepository, type TenantWritable } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import {
  type CustomerPreferenceResponse,
  CustomerPreference,
  toPreferenceResponse,
} from './customer-preference.entity.js';
import { MAX_PREFERENCES_PER_CUSTOMER } from './customer-values.js';
import { type CustomerScopes, CustomersService } from './customers.service.js';
import {
  type CreateCustomerPreferenceDto,
  EDITABLE_PREFERENCE_FIELDS,
  PREFERENCE_CRITERIA,
  type UpdateCustomerPreferenceDto,
} from './dto/customer-preference.dto.js';

type Criteria = Pick<CustomerPreference, (typeof PREFERENCE_CRITERIA)[number]>;

/** Bảng địa giới tương ứng từng trường khu vực. */
const AREA_TABLES = [
  ['provinceIds', 'provinces', 'Tỉnh/thành'],
  ['districtIds', 'districts', 'Quận/huyện'],
  ['wardIds', 'wards', 'Phường/xã'],
] as const;

/**
 * Nhu cầu của khách (TASK-078). Xem theo quyền xem khách (`customer.view`); thêm, sửa, xoá nhu cầu là sửa
 * khách nên cần `customer.edit` trong phạm vi với khách đó. Thao tác ghi nhật ký của khách.
 */
@Injectable()
export class CustomerPreferencesService {
  private readonly preferences: TenantRepository<CustomerPreference>;

  constructor(
    @InjectRepository(CustomerPreference) repository: Repository<CustomerPreference>,
    private readonly dataSource: DataSource,
    private readonly customers: CustomersService,
  ) {
    this.preferences = new TenantRepository(repository);
  }

  /** Nhu cầu của khách, tạo trước đứng trước. Không xem được khách → 404. */
  async findAll(
    actor: Actor,
    customerId: string,
    scopes: CustomerScopes,
  ): Promise<CustomerPreferenceResponse[]> {
    await this.customers.findOne(actor, customerId, scopes);
    const preferences = await this.preferences
      .createQueryBuilder(actor.tenantId, 'cp', (query) =>
        query.where('cp.customerId = :customerId', { customerId }),
      )
      .orderBy('cp.createdAt', 'ASC')
      .addOrderBy('cp.id', 'ASC')
      .getMany();
    return preferences.map(toPreferenceResponse);
  }

  /** Thêm nhu cầu → 201. Tối đa MAX_PREFERENCES_PER_CUSTOMER nhu cầu mỗi khách (vượt → 422). */
  async create(
    actor: Actor,
    customerId: string,
    dto: CreateCustomerPreferenceDto,
    scopes: CustomerScopes,
  ): Promise<CustomerPreferenceResponse> {
    const criteria = Object.fromEntries(
      PREFERENCE_CRITERIA.map((field) => [field, dto[field] ?? null]),
    ) as Criteria;
    assertCriteria(criteria);
    await this.assertAreas(criteria);

    const created = await this.dataSource.transaction(async (manager) => {
      await this.lockCustomer(manager, actor, customerId, scopes);
      const preferences = this.preferences.withManager(manager);
      const count = await preferences.count(actor.tenantId, { customerId });
      if (count >= MAX_PREFERENCES_PER_CUSTOMER) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          `Mỗi khách có tối đa ${MAX_PREFERENCES_PER_CUSTOMER} nhu cầu`,
        );
      }
      const preference = await preferences.create(actor.tenantId, {
        customerId,
        transactionType: dto.transactionType ?? 'SALE',
        isActive: dto.isActive ?? true,
        ...criteria,
      });
      await this.record(manager, actor, customerId, 'customer.add_preference', {
        preferenceId: [null, preference.id],
      });
      return preference;
    });
    return toPreferenceResponse(created);
  }

  /** Sửa nhu cầu: chỉ đổi trường được gửi. Nhu cầu không thuộc khách → 404; `expectedUpdatedAt` lệch → 409. */
  async update(
    actor: Actor,
    customerId: string,
    id: string,
    dto: UpdateCustomerPreferenceDto,
    scopes: CustomerScopes,
  ): Promise<CustomerPreferenceResponse> {
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_PREFERENCE_FIELDS) {
      if (dto[field] !== undefined) {
        patch[field] = dto[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      throw invalid([{ message: 'Cần gửi ít nhất một trường để cập nhật' }]);
    }
    await this.assertAreas(patch);

    const updated = await this.dataSource.transaction(async (manager) => {
      await this.lockCustomer(manager, actor, customerId, scopes);
      const preferences = this.preferences.withManager(manager);
      const current = await this.findOwn(preferences, actor, customerId, id);
      if (
        dto.expectedUpdatedAt &&
        dto.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()
      ) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'Nhu cầu đã được người khác cập nhật, vui lòng tải lại rồi thao tác lại',
        );
      }
      assertCriteria({ ...current, ...patch } as CustomerPreference);

      const next = await preferences.update(
        actor.tenantId,
        id,
        patch as TenantWritable<CustomerPreference>,
      );
      const changes = diff(current, patch);
      if (changes) {
        await this.record(manager, actor, customerId, 'customer.update_preference', {
          preferenceId: [id, id],
          ...changes,
        });
      }
      return next ?? current;
    });
    return toPreferenceResponse(updated);
  }

  /** Xoá mềm nhu cầu → 204. */
  async remove(
    actor: Actor,
    customerId: string,
    id: string,
    scopes: CustomerScopes,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockCustomer(manager, actor, customerId, scopes);
      const preferences = this.preferences.withManager(manager);
      await this.findOwn(preferences, actor, customerId, id);
      await preferences.softDelete(actor.tenantId, id);
      await this.record(manager, actor, customerId, 'customer.remove_preference', {
        preferenceId: [id, null],
      });
    });
  }

  private lockCustomer(
    manager: EntityManager,
    actor: Actor,
    customerId: string,
    scopes: CustomerScopes,
  ): Promise<unknown> {
    return this.customers.lockForAction(
      manager,
      actor,
      customerId,
      scopes,
      scopes.edit,
      'Không có quyền sửa khách hàng này',
    );
  }

  private async findOwn(
    preferences: TenantRepository<CustomerPreference>,
    actor: Actor,
    customerId: string,
    id: string,
  ): Promise<CustomerPreference> {
    const preference = await preferences.findById(actor.tenantId, id);
    if (!preference || preference.customerId !== customerId) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy nhu cầu');
    }
    return preference;
  }

  private record(
    manager: EntityManager,
    actor: Actor,
    customerId: string,
    action: `customer.${string}`,
    changes: AuditChanges,
  ): Promise<void> {
    return this.customers.recordActivity(manager, actor, customerId, action, changes);
  }

  /** Mọi id khu vực phải tồn tại và đang dùng (mảng không có khoá ngoại, docs/database.md mục 4.5). */
  private async assertAreas(values: Partial<Record<string, unknown>>): Promise<void> {
    const details: ErrorDetail[] = [];
    for (const [field, table, label] of AREA_TABLES) {
      const ids = values[field];
      if (!Array.isArray(ids) || ids.length === 0) {
        continue;
      }
      const [row] = (await this.dataSource.query(
        `SELECT count(*)::int AS found FROM ${table} WHERE id = ANY($1::uuid[]) AND is_active`,
        [ids],
      )) as { found: number }[];
      if (row?.found !== ids.length) {
        details.push({ field, message: `${label} không tồn tại hoặc đã ngừng dùng` });
      }
    }
    if (details.length > 0) {
      throw invalid(details);
    }
  }
}

/** Cần ít nhất một tiêu chí; khoảng ngân sách, diện tích phải có min ≤ max. */
function assertCriteria(criteria: Criteria): void {
  if (PREFERENCE_CRITERIA.every((field) => criteria[field] === null)) {
    throw invalid([
      { message: 'Nhu cầu cần ít nhất một tiêu chí (loại BĐS, ngân sách, khu vực…)' },
    ]);
  }
  const details: ErrorDetail[] = [];
  if (
    criteria.budgetMin !== null &&
    criteria.budgetMax !== null &&
    criteria.budgetMin > criteria.budgetMax
  ) {
    details.push({ field: 'budgetMax', message: 'budgetMax phải lớn hơn hoặc bằng budgetMin' });
  }
  if (
    criteria.areaMin !== null &&
    criteria.areaMax !== null &&
    criteria.areaMin > criteria.areaMax
  ) {
    details.push({ field: 'areaMax', message: 'areaMax phải lớn hơn hoặc bằng areaMin' });
  }
  if (details.length > 0) {
    throw invalid(details);
  }
}

/** `{ field: [cũ, mới] }` cho các trường thật sự đổi giá trị; không đổi gì → null. */
function diff(current: CustomerPreference, patch: Record<string, unknown>): AuditChanges | null {
  const changes: AuditChanges = {};
  for (const [field, next] of Object.entries(patch)) {
    const previous = (current as unknown as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next ?? null)) {
      changes[field] = [previous, next ?? null];
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function invalid(details: ErrorDetail[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, undefined, details);
}
