import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
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
import type { PropertyListItem } from '../properties/property.response.js';
import { PropertySearchQueryDto } from '../search/property-search-query.dto.js';
import { normalizeSearchFilters } from '../search/search-filters.js';
import type { CreateSavedSearchDto } from './dto/create-saved-search.dto.js';
import type { UpdateSavedSearchDto } from './dto/update-saved-search.dto.js';
import { MAX_SAVED_SEARCHES_PER_USER } from './saved-searches.values.js';

export interface SavedSearchResponse {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  notify: boolean;
  lastNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SavedSearchRow {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  notify: boolean;
  last_notified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, name, filters, notify, last_notified_at, created_at, updated_at';
const NOT_FOUND = 'Không tìm thấy tìm kiếm đã lưu';

function toResponse(row: SavedSearchRow): SavedSearchResponse {
  return {
    id: row.id,
    name: row.name,
    filters: row.filters,
    notify: row.notify,
    lastNotifiedAt: row.last_notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Tìm kiếm đã lưu (TASK-075, bảng `saved_searches`). Mỗi người chỉ thấy và sửa tìm kiếm của chính mình
 * (của người khác, công ty khác hoặc đã xoá → 404). Bộ lọc kiểm bằng đúng schema của `GET /properties`;
 * chạy lại tìm kiếm luôn theo quyền xem BĐS hiện tại của người dùng, không theo lúc lưu.
 */
@Injectable()
export class SavedSearchesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly properties: PropertiesService,
  ) {}

  async create(actor: Actor, dto: CreateSavedSearchDto): Promise<SavedSearchResponse> {
    const filters = normalizeSearchFilters(dto.filters);
    const row = await this.dataSource.transaction(async (manager) => {
      // Khoá dòng user để hai request song song không vượt giới hạn số tìm kiếm.
      await manager.query(`SELECT 1 FROM users WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [
        actor.tenantId,
        actor.userId,
      ]);
      const [count] = (await manager.query(
        `SELECT COUNT(*)::int AS total FROM saved_searches
          WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [actor.tenantId, actor.userId],
      )) as { total: number }[];
      if ((count?.total ?? 0) >= MAX_SAVED_SEARCHES_PER_USER) {
        throw new AppException(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          `Chỉ lưu được tối đa ${MAX_SAVED_SEARCHES_PER_USER} tìm kiếm, hãy xoá bớt tìm kiếm cũ`,
        );
      }
      const [inserted] = (await manager.query(
        `INSERT INTO saved_searches (tenant_id, user_id, name, filters, notify)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING ${COLUMNS}`,
        [actor.tenantId, actor.userId, dto.name, JSON.stringify(filters), dto.notify ?? true],
      )) as SavedSearchRow[];
      return inserted;
    });
    if (!row) {
      throw new AppException(ErrorCode.INTERNAL_ERROR);
    }
    return toResponse(row);
  }

  /** Tìm kiếm đã lưu của mình, mới tạo trước. */
  async findAll(actor: Actor, query: PaginationQueryDto): Promise<Paginated<SavedSearchResponse>> {
    const params = [actor.tenantId, actor.userId];
    const where = 'tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL';
    const [count] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM saved_searches WHERE ${where}`,
      params,
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM saved_searches WHERE ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $3 OFFSET $4`,
      [...params, query.pageSize, query.offset],
    )) as SavedSearchRow[];
    return new Paginated(rows.map(toResponse), query.page, query.pageSize, count?.total ?? 0);
  }

  async findOne(actor: Actor, id: string): Promise<SavedSearchResponse> {
    return toResponse(await this.load(actor, id));
  }

  async update(actor: Actor, id: string, dto: UpdateSavedSearchDto): Promise<SavedSearchResponse> {
    if (dto.name === undefined && dto.filters === undefined && dto.notify === undefined) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Cần gửi ít nhất một trường để sửa');
    }
    const filters = dto.filters === undefined ? undefined : normalizeSearchFilters(dto.filters);
    const [rows] = (await this.dataSource.query(
      `UPDATE saved_searches
          SET name = COALESCE($3, name),
              filters = COALESCE($4::jsonb, filters),
              notify = COALESCE($5, notify)
        WHERE tenant_id = $1 AND id = $2 AND user_id = $6 AND deleted_at IS NULL
        RETURNING ${COLUMNS}`,
      [
        actor.tenantId,
        id,
        dto.name ?? null,
        filters === undefined ? null : JSON.stringify(filters),
        dto.notify ?? null,
        actor.userId,
      ],
    )) as [SavedSearchRow[], number];
    const [row] = rows;
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, NOT_FOUND);
    }
    return toResponse(row);
  }

  /** Xoá mềm. */
  async remove(actor: Actor, id: string): Promise<void> {
    const [, affected] = (await this.dataSource.query(
      `UPDATE saved_searches SET deleted_at = now()
        WHERE tenant_id = $1 AND id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [actor.tenantId, id, actor.userId],
    )) as [unknown, number];
    if (affected === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, NOT_FOUND);
    }
  }

  /**
   * Chạy lại tìm kiếm đã lưu: kết quả giống `GET /properties` với bộ lọc đã lưu và trang yêu cầu,
   * theo quyền xem hiện tại của người dùng.
   */
  async runSearch(
    actor: Actor,
    id: string,
    page: PaginationQueryDto,
    scopes: PropertyScopes,
  ): Promise<Paginated<PropertyListItem>> {
    const saved = await this.load(actor, id);
    // Kiểm lại bộ lọc phòng khi schema tìm kiếm đổi sau lúc lưu.
    const filters = normalizeSearchFilters(saved.filters);
    const query = plainToInstance(PropertySearchQueryDto, {
      ...filters,
      page: page.page,
      pageSize: page.pageSize,
    });
    return this.properties.findAll(actor, query, scopes);
  }

  private async load(actor: Actor, id: string): Promise<SavedSearchRow> {
    const [row] = (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM saved_searches
        WHERE tenant_id = $1 AND id = $2 AND user_id = $3 AND deleted_at IS NULL`,
      [actor.tenantId, id, actor.userId],
    )) as SavedSearchRow[];
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, NOT_FOUND);
    }
    return row;
  }
}
