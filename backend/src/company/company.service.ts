import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { assertTenant } from '../database/tenant.repository.js';
import type { Actor } from '../properties/properties.service.js';
import {
  DEFAULT_VERIFY_INTERVAL_DAYS,
  MAX_VERIFY_INTERVAL_DAYS,
} from '../properties/property-values.js';
import type { UpdateCompanyDto } from './dto/company.dto.js';

/** `GET /company` (TASK-105). */
export interface CompanyInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  settings: {
    /** Giá trị đang áp dụng: cài đặt của công ty, hoặc mặc định khi chưa đặt. */
    verifyIntervalDays: number;
    verifyIntervalDaysDefault: number;
  };
  stats: { users: number; departments: number; teams: number };
}

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
  verify_interval_days: unknown;
  users: number;
  departments: number;
  teams: number;
}

/** Cài đặt hợp lệ thì dùng, không thì mặc định (cùng quy tắc với job xác minh lại ở properties.service). */
function effectiveInterval(value: unknown): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_VERIFY_INTERVAL_DAYS
    ? value
    : DEFAULT_VERIFY_INTERVAL_DAYS;
}

/**
 * Thông tin và cài đặt của công ty đang đăng nhập (TASK-105, phase0/01-PRD.md: COMPANY_ADMIN cấu hình công ty).
 * Cần `admin.manage`. Không đổi slug hay trạng thái: tạm ngưng công ty là việc của nền tảng.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async get(actor: Actor): Promise<CompanyInfo> {
    assertTenant(actor.tenantId);
    const [row] = (await this.dataSource.query(
      `SELECT c.id, c.name, c.slug, c.status, c.created_at,
              c.settings -> 'verify_interval_days' AS verify_interval_days,
              (SELECT count(*)::int FROM users u
                WHERE u.tenant_id = c.id AND u.deleted_at IS NULL) AS users,
              (SELECT count(*)::int FROM departments d
                WHERE d.tenant_id = c.id AND d.deleted_at IS NULL) AS departments,
              (SELECT count(*)::int FROM teams t
                WHERE t.tenant_id = c.id AND t.deleted_at IS NULL) AS teams
         FROM companies c
        WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [actor.tenantId],
    )) as CompanyRow[];
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy công ty');
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      settings: {
        verifyIntervalDays: effectiveInterval(row.verify_interval_days),
        verifyIntervalDaysDefault: DEFAULT_VERIFY_INTERVAL_DAYS,
      },
      stats: { users: row.users, departments: row.departments, teams: row.teams },
    };
  }

  async update(actor: Actor, dto: UpdateCompanyDto): Promise<CompanyInfo> {
    const current = await this.get(actor);
    const changes: Record<string, [unknown, unknown]> = {};
    if (dto.name !== undefined && dto.name !== current.name) {
      changes['name'] = [current.name, dto.name];
    }
    if (
      dto.verifyIntervalDays !== undefined &&
      dto.verifyIntervalDays !== current.settings.verifyIntervalDays
    ) {
      changes['verifyIntervalDays'] = [current.settings.verifyIntervalDays, dto.verifyIntervalDays];
    }
    if (Object.keys(changes).length === 0) {
      return current;
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE companies
            SET name = $2,
                settings = CASE WHEN $3::int IS NULL THEN settings
                                ELSE settings || jsonb_build_object('verify_interval_days', $3::int) END
          WHERE id = $1`,
        [actor.tenantId, dto.name ?? current.name, dto.verifyIntervalDays ?? null],
      );
      await this.audit.record(manager, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'company.update',
        entityType: 'company',
        entityId: actor.tenantId,
        changes,
      });
    });
    return this.get(actor);
  }
}
