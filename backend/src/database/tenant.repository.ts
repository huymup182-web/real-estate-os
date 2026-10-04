import type {
  DeepPartial,
  EntityManager,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import type { TenantEntity } from './tenant-entity.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lỗi lập trình: truy vấn bảng nghiệp vụ mà không có tenant hợp lệ. */
export class MissingTenantError extends Error {
  constructor() {
    super('Truy vấn bảng nghiệp vụ bắt buộc có tenantId hợp lệ');
    this.name = 'MissingTenantError';
  }
}

function assertTenant(tenantId: string): void {
  if (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId)) {
    throw new MissingTenantError();
  }
}

/** Các trường hệ thống tự quản lý, không cho caller ghi. */
const MANAGED_FIELDS = ['id', 'tenantId', 'createdAt', 'updatedAt', 'deletedAt'] as const;
type ManagedField = (typeof MANAGED_FIELDS)[number];
export type TenantWritable<T extends TenantEntity> = Omit<DeepPartial<T>, ManagedField>;
export type TenantWhere<T extends TenantEntity> = Omit<FindOptionsWhere<T>, 'tenantId'>;

/** Bỏ các trường hệ thống, kể cả khi caller ép kiểu để gửi lên (vd dữ liệu từ client). */
function withoutManagedFields(values: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !(MANAGED_FIELDS as readonly string[]).includes(key)),
  );
}

/**
 * Repository cơ sở bắt buộc tenant (phase0/02-ARCHITECTURE.md mục 3, lớp 2):
 * - Mọi truy vấn tự thêm `tenant_id = :tenantId`; tenantId thiếu hoặc sai → MissingTenantError.
 * - Khi tạo bản ghi, tenant_id lấy từ tham số, không bao giờ từ dữ liệu client.
 * - Không đổi được tenant_id của bản ghi đã có.
 * tenantId lấy từ token đăng nhập (TASK-047), không lấy từ body/query.
 */
export class TenantRepository<T extends TenantEntity> {
  constructor(private readonly repository: Repository<T>) {}

  /** Repository cùng entity nhưng chạy trong transaction của `manager`. */
  withManager(manager: EntityManager): TenantRepository<T> {
    return new TenantRepository(manager.getRepository<T>(this.repository.target));
  }

  private scoped(tenantId: string, where?: TenantWhere<T>): FindOptionsWhere<T> {
    assertTenant(tenantId);
    return { ...where, tenantId } as FindOptionsWhere<T>;
  }

  async find(tenantId: string, where?: TenantWhere<T>): Promise<T[]> {
    return this.repository.find({ where: this.scoped(tenantId, where) });
  }

  async findById(tenantId: string, id: string): Promise<T | null> {
    return this.repository.findOne({ where: this.scoped(tenantId, { id } as TenantWhere<T>) });
  }

  async count(tenantId: string, where?: TenantWhere<T>): Promise<number> {
    return this.repository.count({ where: this.scoped(tenantId, where) });
  }

  async create(tenantId: string, values: TenantWritable<T>): Promise<T> {
    assertTenant(tenantId);
    const data = withoutManagedFields(values);
    const entity = this.repository.create({ ...data, tenantId } as DeepPartial<T>);
    const saved = await this.repository.save(entity);
    // Đọc lại để có id và các giá trị mặc định do database sinh.
    return this.repository.findOneOrFail({
      where: this.scoped(tenantId, { id: saved.id } as TenantWhere<T>),
    });
  }

  /** Cập nhật bản ghi của tenant; trả về null nếu không có (hoặc thuộc tenant khác). */
  async update(tenantId: string, id: string, values: TenantWritable<T>): Promise<T | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) {
      return null;
    }
    const patch = withoutManagedFields(values);
    if (Object.keys(patch).length > 0) {
      await this.repository.update(
        this.scoped(tenantId, { id } as TenantWhere<T>),
        patch as QueryDeepPartialEntity<T>,
      );
    }
    return this.findById(tenantId, id);
  }

  /** Soft delete; trả về false nếu không có bản ghi (hoặc thuộc tenant khác). */
  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.repository.softDelete(
      this.scoped(tenantId, { id } as TenantWhere<T>),
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Query builder cho truy vấn phức tạp (lọc, sắp xếp, phân trang). `build` thêm điều kiện của caller;
   * điều kiện tenant được gắn SAU CÙNG (điều kiện của caller được gom trong ngoặc), nên `where()` hay
   * `orWhere()` trong `build` không xoá hay vượt qua được nó. Không gọi where()/orWhere() trên builder trả về.
   */
  createQueryBuilder(
    tenantId: string,
    alias: string,
    build: (query: SelectQueryBuilder<T>) => SelectQueryBuilder<T> = (query) => query,
  ): SelectQueryBuilder<T> {
    assertTenant(tenantId);
    const query = build(this.repository.createQueryBuilder(alias));
    const callerWheres = query.expressionMap.wheres;
    if (callerWheres.length === 0) {
      return query.where(`${alias}.tenantId = :tenantId`, { tenantId });
    }
    // Gom điều kiện của caller vào một cụm (có ngoặc) để OR của caller không vượt qua điều kiện tenant.
    query.expressionMap.wheres = [{ type: 'simple', condition: callerWheres }];
    return query.andWhere(`${alias}.tenantId = :tenantId`, { tenantId });
  }
}
