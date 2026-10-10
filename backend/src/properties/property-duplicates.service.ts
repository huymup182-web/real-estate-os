import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { CreatePropertyDto } from './dto/create-property.dto.js';
import {
  DUPLICATE_RADIUS_M,
  DUPLICATE_THRESHOLD,
  type DuplicateSubject,
  scoreDuplicate,
} from './duplicate-score.js';
import { type Actor, PropertiesService, type PropertyScopes } from './properties.service.js';

/** Số BĐS nghi trùng tối đa trả về. */
export const MAX_DUPLICATES = 5;
/** Số BĐS gần nhất (cùng phường hoặc trong bán kính) đem ra so. */
const CANDIDATE_LIMIT = 200;

/** BĐS nghi trùng. Người hỏi không xem được BĐS đó thì chỉ có mã (để báo admin), không có chi tiết. */
export interface DuplicateMatch {
  code: string;
  similarity: number;
  reasons: string[];
  property: {
    id: string;
    title: string;
    price: number;
    area: number;
    status: string;
  } | null;
}

export interface DuplicateReport {
  /** Từ độ giống này trở lên mới vào danh sách. */
  threshold: number;
  /** Độ giống cao trước. */
  matches: DuplicateMatch[];
}

interface Subject extends DuplicateSubject {
  id: string | null;
  transactionType: string;
  propertyType: string;
  latitude: number | null;
  longitude: number | null;
}

interface CandidateRow {
  id: string;
  code: string;
  title: string;
  status: string;
  price: string;
  area: string;
  ward_id: string;
  street_address: string | null;
  description: string | null;
  owner_phone: string | null;
  distance_m: number | null;
}

/**
 * Phát hiện BĐS nghi trùng (TASK-144, MASTER_PLAN mục 9). So trong cả công ty (BĐS trùng thường do môi giới
 * khác đăng), cùng loại giao dịch, cùng loại BĐS, cùng phường/xã hoặc cách tối đa 300 m. Chỉ cảnh báo: không chặn
 * tạo BĐS, không tự xoá; admin quyết định.
 */
@Injectable()
export class PropertyDuplicatesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly properties: PropertiesService,
  ) {}

  /** BĐS sắp tạo (dữ liệu form) có thể trùng BĐS nào. Chưa có chủ nhà nên không so SĐT. */
  checkNew(actor: Actor, dto: CreatePropertyDto, scopes: PropertyScopes): Promise<DuplicateReport> {
    return this.report(actor, scopes, {
      id: null,
      transactionType: 'SALE',
      propertyType: dto.propertyType,
      wardId: dto.wardId,
      price: dto.price,
      area: dto.area,
      streetAddress: dto.streetAddress ?? null,
      description: dto.description ?? null,
      ownerPhone: null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    });
  }

  /** BĐS [id] (trong phạm vi `property.view`, không thì 404) có thể trùng BĐS nào. */
  async forProperty(actor: Actor, id: string, scopes: PropertyScopes): Promise<DuplicateReport> {
    await this.properties.assertVisible(actor, id, scopes);
    const [row] = (await this.dataSource.query(
      `SELECT p.transaction_type, p.property_type, p.ward_id, p.price, p.area, p.street_address,
              p.description, p.latitude, p.longitude, o.phone AS owner_phone
         FROM properties p
         LEFT JOIN owners o ON o.tenant_id = p.tenant_id AND o.id = p.owner_id AND o.deleted_at IS NULL
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.deleted_at IS NULL`,
      [actor.tenantId, id],
    )) as {
      transaction_type: string;
      property_type: string;
      ward_id: string;
      price: string;
      area: string;
      street_address: string | null;
      description: string | null;
      latitude: string | null;
      longitude: string | null;
      owner_phone: string | null;
    }[];
    if (!row) {
      return { threshold: DUPLICATE_THRESHOLD, matches: [] };
    }
    return this.report(actor, scopes, {
      id,
      transactionType: row.transaction_type,
      propertyType: row.property_type,
      wardId: row.ward_id,
      price: Number(row.price),
      area: Number(row.area),
      streetAddress: row.street_address,
      description: row.description,
      ownerPhone: row.owner_phone,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
    });
  }

  private async report(
    actor: Actor,
    scopes: PropertyScopes,
    subject: Subject,
  ): Promise<DuplicateReport> {
    const hasPoint = subject.latitude !== null && subject.longitude !== null;
    const rows = (await this.dataSource.query(
      `WITH here AS (
         SELECT CASE WHEN $6::float8 IS NOT NULL AND $7::float8 IS NOT NULL
                     THEN ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)::geography END AS point
       )
       SELECT p.id, p.code, p.title, p.status, p.price, p.area, p.ward_id, p.street_address,
              p.description, o.phone AS owner_phone,
              CASE WHEN here.point IS NOT NULL AND p.location IS NOT NULL
                   THEN ST_Distance(p.location, here.point) END AS distance_m
         FROM properties p
         CROSS JOIN here
         LEFT JOIN owners o ON o.tenant_id = p.tenant_id AND o.id = p.owner_id AND o.deleted_at IS NULL
        WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
          AND ($2::uuid IS NULL OR p.id <> $2::uuid)
          AND p.transaction_type = $3 AND p.property_type = $4
          AND (p.ward_id = $5
               OR (here.point IS NOT NULL AND p.location IS NOT NULL
                   AND ST_DWithin(p.location, here.point, $8)))
        ORDER BY p.created_at DESC
        LIMIT $9`,
      [
        actor.tenantId,
        subject.id,
        subject.transactionType,
        subject.propertyType,
        subject.wardId,
        hasPoint ? subject.latitude : null,
        hasPoint ? subject.longitude : null,
        DUPLICATE_RADIUS_M,
        CANDIDATE_LIMIT,
      ],
    )) as CandidateRow[];

    const scored = rows
      .map((row) => ({
        row,
        score: scoreDuplicate(subject, {
          wardId: row.ward_id,
          price: Number(row.price),
          area: Number(row.area),
          streetAddress: row.street_address,
          description: row.description,
          ownerPhone: row.owner_phone,
          distanceM: row.distance_m === null ? null : Number(row.distance_m),
        }),
      }))
      .filter((item) => item.score.similarity >= DUPLICATE_THRESHOLD)
      .sort((a, b) => b.score.similarity - a.score.similarity)
      .slice(0, MAX_DUPLICATES);

    const visible = await this.visibleIds(
      actor,
      scopes,
      scored.map((item) => item.row.id),
    );
    return {
      threshold: DUPLICATE_THRESHOLD,
      matches: scored.map(({ row, score }) => ({
        code: row.code,
        similarity: score.similarity,
        reasons: score.reasons,
        property: visible.has(row.id)
          ? {
              id: row.id,
              title: row.title,
              price: Number(row.price),
              area: Number(row.area),
              status: row.status,
            }
          : null,
      })),
    };
  }

  private async visibleIds(
    actor: Actor,
    scopes: PropertyScopes,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0 || scopes.view === undefined) {
      return new Set();
    }
    const rows = await this.properties
      .visible(actor, scopes)
      .andWhere('p.id IN (:...ids)', { ids })
      .select('p.id', 'id')
      .getRawMany<{ id: string }>();
    return new Set(rows.map((row) => row.id));
  }
}
