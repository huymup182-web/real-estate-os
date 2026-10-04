import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { PropertiesService } from '../src/properties/properties.service.js';
import { PROPERTY_VERIFICATION_JOB } from '../src/properties/property-verification.job.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface Detail {
  id: string;
  status: string;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  verifiedBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  [key: string]: unknown;
}

/**
 * Công ty A: admin; phòng D1 có `manager` (MANAGER), team T1 (trưởng nhóm `leader`) gồm agent1, agent2;
 * phòng D2 có agent4. Công ty B: adminB. Mỗi test dùng BĐS mới do agent1 tạo.
 */
describe('Xác minh BĐS POST /api/v1/properties/:id/verify và job VERIFY_REQUIRED', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let tenantB: string;
  let khanhHoa: string;
  let nhaTrang: string;
  let vinhHai: string;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    db = app.get(DataSource);

    khanhHoa = await insertId(`INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`);
    nhaTrang = await insertId(
      `INSERT INTO districts (province_id, code, name) VALUES ($1, '568', 'Nha Trang')`,
      [khanhHoa],
    );
    vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );

    const admin = await register('admin@a.vn');
    tenantA = admin.tenantId;
    userIds['admin'] = admin.userId;
    const d1 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D1')`, [
      tenantA,
    ]);
    const d2 = await insertId(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'D2')`, [
      tenantA,
    ]);
    const hash = await hashPassword(PASSWORD);
    for (const [name, role, department] of [
      ['manager', 'MANAGER', d1],
      ['leader', 'TEAM_LEADER', d1],
      ['agent1', 'AGENT', d1],
      ['agent2', 'AGENT', d1],
      ['agent4', 'AGENT', d2],
    ] as const) {
      userIds[name] = await insertUser(name, hash, department, role);
    }
    const team = await insertId(
      `INSERT INTO teams (tenant_id, department_id, name, leader_id) VALUES ($1, $2, 'T1', $3)`,
      [tenantA, d1, userIds['leader']],
    );
    for (const name of ['agent1', 'agent2']) {
      await db.query(`INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)`, [
        tenantA,
        team,
        userIds[name],
      ]);
    }
    for (const name of Object.keys(userIds)) {
      tokens[name] = await login(`${name}@a.vn`);
    }
    tenantB = (await register('admin@b.vn')).tenantId;
    tokens['adminB'] = await login('admin@b.vn');
  });

  after(async () => {
    await app.close();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function insertUser(
    name: string,
    hash: string,
    department: string | null,
    roleCode: string,
  ): Promise<string> {
    const id = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, department_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantA, `${name}@a.vn`, hash, name, department],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT $1, id, tenant_id FROM roles WHERE tenant_id = $2 AND code = $3`,
      [id, tenantA, roleCode],
    );
    return id;
  }

  async function register(email: string): Promise<{ userId: string; tenantId: string }> {
    const response = await request('POST', '/auth/register', {
      companyName: `Công ty ${email}`,
      fullName: 'Quản trị',
      email,
      password: PASSWORD,
    });
    assert.equal(response.status, 201);
    const data = (
      (await response.json()) as { data: { user: { id: string }; company: { id: string } } }
    ).data;
    return { userId: data.user.id, tenantId: data.company.id };
  }

  async function login(email: string): Promise<string> {
    const response = await request('POST', '/auth/login', {
      identifier: email,
      password: PASSWORD,
    });
    assert.equal(response.status, 200, email);
    return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
  }

  function request(
    method: string,
    path: string,
    payload?: unknown,
    accessToken?: string,
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  async function createProperty(user = 'agent1', token = tokens[user]): Promise<Detail> {
    const response = await request(
      'POST',
      '/properties',
      {
        title: 'Nhà phố Vĩnh Hải',
        description: 'Gần biển',
        propertyType: 'HOUSE',
        price: 3_500_000_000,
        area: 70,
        provinceId: khanhHoa,
        districtId: nhaTrang,
        wardId: vinhHai,
        streetAddress: '12 Đường 2/4',
        latitude: 12.276543,
        longitude: 109.198765,
        commissionType: 'PERCENT',
        commissionValue: 1.5,
      },
      token,
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: Detail }).data;
  }

  function verify(id: string, user: string, payload: unknown = {}): Promise<Response> {
    return request('POST', `/properties/${id}/verify`, payload, tokens[user]);
  }

  async function verified(id: string, user: string): Promise<Detail> {
    const response = await verify(id, user);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return ((await response.json()) as { data: Detail }).data;
  }

  async function setStatus(id: string, status: string): Promise<void> {
    await db.query(`UPDATE properties SET status = $2 WHERE id = $1`, [id, status]);
  }

  async function row(id: string): Promise<{ status: string; verification_status: string }> {
    const [found] = (await db.query(
      'SELECT status, verification_status FROM properties WHERE id = $1',
      [id],
    )) as { status: string; verification_status: string }[];
    assert.ok(found);
    return found;
  }

  it('môi giới phụ trách xác minh → 200: VERIFIED, ghi người và thời điểm xác minh; trạng thái bán giữ nguyên', async () => {
    const property = await createProperty();
    assert.equal(property.verificationStatus, 'UNVERIFIED');
    assert.equal(property.lastVerifiedAt, null);
    const before = Date.now();
    const data = await verified(property.id, 'agent1');
    assert.equal(data.verificationStatus, 'VERIFIED');
    assert.equal(data.verifiedBy, userIds['agent1']);
    assert.equal(data.updatedBy, userIds['agent1']);
    assert.equal(data.status, 'AVAILABLE');
    assert.ok(new Date(data.lastVerifiedAt ?? 0).getTime() >= before - 1000);
    const again = await verified(property.id, 'agent1');
    assert.ok(new Date(again.lastVerifiedAt ?? 0) >= new Date(data.lastVerifiedAt ?? 0));
  });

  it('BĐS VERIFY_REQUIRED hoặc EXPIRED được mở bán lại (AVAILABLE); PENDING, SOLD, HIDDEN giữ nguyên', async () => {
    for (const [from, to] of [
      ['VERIFY_REQUIRED', 'AVAILABLE'],
      ['EXPIRED', 'AVAILABLE'],
      ['PENDING', 'PENDING'],
      ['SOLD', 'SOLD'],
      ['HIDDEN', 'HIDDEN'],
    ] as const) {
      const property = await createProperty();
      await setStatus(property.id, from);
      const data = await verified(property.id, 'leader');
      assert.equal(data.status, to, from);
      assert.equal(data.verificationStatus, 'VERIFIED');
      assert.equal(data.verifiedBy, userIds['leader']);
    }
  });

  it('quyền theo phạm vi property.verify: AGENT chỉ BĐS mình, trưởng nhóm theo team, quản lý theo phòng', async () => {
    const property = await createProperty();
    assert.equal((await verify(property.id, 'agent2')).status, 403);
    assert.equal((await verify(property.id, 'agent4')).status, 403);
    assert.equal((await verified(property.id, 'manager')).verifiedBy, userIds['manager']);
    assert.equal((await verified(property.id, 'admin')).verifiedBy, userIds['admin']);
    const agent2Own = await createProperty('agent2');
    assert.equal((await verified(agent2Own.id, 'agent2')).verifiedBy, userIds['agent2']);
  });

  it('công ty khác, không tồn tại, đang ẩn với người không sửa được → 404; id sai → 400; chưa đăng nhập → 401; expectedUpdatedAt cũ → 409', async () => {
    const property = await createProperty();
    assert.equal((await verify(property.id, 'adminB')).status, 404);
    assert.equal((await verify('00000000-0000-4000-8000-000000000000', 'agent1')).status, 404);
    assert.equal((await verify('abc', 'agent1')).status, 400);
    assert.equal((await request('POST', `/properties/${property.id}/verify`, {})).status, 401);
    const hidden = await createProperty('agent2');
    await setStatus(hidden.id, 'HIDDEN');
    assert.equal((await verify(hidden.id, 'agent4')).status, 404);
    const stale = await verify(property.id, 'agent1', {
      expectedUpdatedAt: '2020-01-01T00:00:00Z',
    });
    assert.equal(stale.status, 409);
    assert.equal(
      (await verify(property.id, 'agent1', { expectedUpdatedAt: property.updatedAt })).status,
      200,
    );
    assert.equal((await verify(property.id, 'agent1', { expectedUpdatedAt: 'x' })).status, 400);
    assert.equal((await row(property.id)).verification_status, 'VERIFIED');
  });

  it('job: BĐS AVAILABLE/PENDING quá 30 ngày chưa xác minh → VERIFY_REQUIRED, EXPIRED; công ty đặt được số ngày riêng', async () => {
    const service = app.get(PropertiesService);
    await service.markOverdueForVerification();
    const ago = (days: number): Date => new Date(Date.now() - days * 86_400_000);
    const backdate = async (id: string, created: Date, verifiedAt: Date | null): Promise<void> => {
      await db.query(`UPDATE properties SET created_at = $2, last_verified_at = $3 WHERE id = $1`, [
        id,
        created,
        verifiedAt,
      ]);
    };

    const neverVerified = await createProperty();
    await backdate(neverVerified.id, ago(31), null);
    const pending = await createProperty();
    await setStatus(pending.id, 'PENDING');
    await backdate(pending.id, ago(100), ago(31));
    const fresh = await createProperty();
    await backdate(fresh.id, ago(100), ago(29));
    const sold = await createProperty();
    await setStatus(sold.id, 'SOLD');
    await backdate(sold.id, ago(100), null);
    const removed = await createProperty();
    await backdate(removed.id, ago(100), null);
    assert.equal(
      (await request('DELETE', `/properties/${removed.id}`, undefined, tokens['admin'])).status,
      204,
    );
    const otherCompany = await createProperty('_', tokens['adminB']);
    await backdate(otherCompany.id, ago(31), null);

    assert.equal(await service.markOverdueForVerification(), 3);
    assert.deepEqual(await row(neverVerified.id), {
      status: 'VERIFY_REQUIRED',
      verification_status: 'EXPIRED',
    });
    assert.deepEqual(await row(pending.id), {
      status: 'VERIFY_REQUIRED',
      verification_status: 'EXPIRED',
    });
    assert.equal((await row(otherCompany.id)).status, 'VERIFY_REQUIRED');
    assert.equal((await row(fresh.id)).status, 'AVAILABLE');
    assert.equal((await row(sold.id)).status, 'SOLD');
    assert.equal((await row(removed.id)).status, 'AVAILABLE');
    assert.equal(await service.markOverdueForVerification(), 0, 'chạy lại không đổi gì');

    const [audit] = (await db.query('SELECT updated_by FROM properties WHERE id = $1', [
      neverVerified.id,
    ])) as { updated_by: string }[];
    assert.equal(audit?.updated_by, userIds['agent1'], 'job không ghi đè người sửa');

    // Xác minh lại thì mở bán lại; BĐS bị chuyển hiện trạng thái mới ở chi tiết.
    const reopened = await verified(neverVerified.id, 'agent1');
    assert.equal(reopened.status, 'AVAILABLE');
    assert.equal(reopened.verificationStatus, 'VERIFIED');

    // Công ty B đặt 60 ngày; giá trị sai thì dùng mặc định 30.
    await db.query(
      `UPDATE companies SET settings = settings || '{"verify_interval_days": 60}' WHERE id = $1`,
      [tenantB],
    );
    const b45 = await createProperty('_', tokens['adminB']);
    await backdate(b45.id, ago(45), null);
    const b61 = await createProperty('_', tokens['adminB']);
    await backdate(b61.id, ago(61), null);
    assert.equal(await service.markOverdueForVerification(), 1);
    assert.equal((await row(b45.id)).status, 'AVAILABLE');
    assert.equal((await row(b61.id)).status, 'VERIFY_REQUIRED');
    for (const invalid of ['0', '"60"', '1.5', '1000']) {
      await db.query(
        `UPDATE companies SET settings = jsonb_set(settings, '{verify_interval_days}', $2::jsonb)
          WHERE id = $1`,
        [tenantB, invalid],
      );
      assert.equal(await service.markOverdueForVerification(), invalid === '0' ? 1 : 0, invalid);
    }
    assert.equal((await row(b45.id)).status, 'VERIFY_REQUIRED');

    // Công ty tạm dừng không bị job đụng tới.
    await db.query(`UPDATE companies SET status = 'SUSPENDED' WHERE id = $1`, [tenantA]);
    const suspended = await createPropertyDirect();
    await backdate(suspended, ago(100), null);
    assert.equal(await service.markOverdueForVerification(), 0);
    assert.equal((await row(suspended)).status, 'AVAILABLE');
    await db.query(`UPDATE companies SET status = 'ACTIVE' WHERE id = $1`, [tenantA]);
  });

  it('job được đăng ký chạy mỗi giờ', () => {
    const job = app.get(SchedulerRegistry).getCronJob(PROPERTY_VERIFICATION_JOB);
    assert.equal(String(job.cronTime.source), '0 0-23/1 * * *');
  });

  /** Tạo BĐS thẳng trong database (công ty tạm dừng thì API từ chối). */
  async function createPropertyDirect(): Promise<string> {
    return insertId(
      `INSERT INTO properties (tenant_id, code, title, property_type, price, area, province_id, ward_id,
                               agent_id)
       VALUES ($1, 'BDS-TAMDUNG', 'Tạm dừng', 'HOUSE', 1, 50, $2, $3, $4)`,
      [tenantA, khanhHoa, vinhHai, userIds['agent1']],
    );
  }
});
