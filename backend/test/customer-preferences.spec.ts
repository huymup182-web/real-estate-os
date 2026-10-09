import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { MAX_PREFERENCES_PER_CUSTOMER } from '../src/customers/customer-values.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const MISSING = '00000000-0000-4000-8000-000000000000';

interface Preference {
  id: string;
  customerId: string;
  transactionType: string;
  propertyTypes: string[] | null;
  budgetMin: number | null;
  budgetMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  bedroomsMin: number | null;
  provinceIds: string[] | null;
  districtIds: string[] | null;
  wardIds: string[] | null;
  directions: string[] | null;
  legalStatuses: string[] | null;
  minRoadAccess: string | null;
  isActive: boolean;
  updatedAt: string;
  [key: string]: unknown;
}

interface ApiError {
  error: { code: string; details?: { field?: string }[] };
}

/**
 * Công ty A: admin; phòng D1 có team T1 (trưởng nhóm `leader`) gồm agent1, agent2; `viewer` (role tuỳ
 * chỉnh: xem khách COMPANY, sửa khách OWN). Mỗi test dùng khách mới của agent1 (trừ khi ghi khác).
 */
describe('/api/v1/customers/:customerId/preferences', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let tenantA: string;
  let khanhHoa: string;
  let oldProvince: string;
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
    oldProvince = await insertId(
      `INSERT INTO provinces (code, name, is_active) VALUES ('99', 'Tỉnh cũ', false)`,
    );
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
    const viewerRole = await insertId(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'CUSTOMER_VIEWER', 'Xem khách')`,
      [tenantA],
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, CASE WHEN code = 'customer.view' THEN 'COMPANY' ELSE 'OWN' END
         FROM permissions WHERE code IN ('customer.view', 'customer.edit')`,
      [viewerRole],
    );
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [
      ['leader', 'TEAM_LEADER'],
      ['agent1', 'AGENT'],
      ['agent2', 'AGENT'],
      ['viewer', 'CUSTOMER_VIEWER'],
    ] as const) {
      userIds[name] = await insertUser(name, hash, d1, role);
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
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');
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
    department: string,
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

  function as(user: string, method: string, path: string, payload?: unknown): Promise<Response> {
    return request(method, path, payload, tokens[user]);
  }

  async function createCustomer(user = 'agent1'): Promise<string> {
    const response = await as(user, 'POST', '/customers', {
      fullName: 'Khách cần mua',
      phone: '+84901234567',
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  }

  async function addPreference(
    customerId: string,
    payload: Record<string, unknown> = { propertyTypes: ['HOUSE'], budgetMax: 5_000_000_000 },
    user = 'agent1',
  ): Promise<Preference> {
    const response = await as(user, 'POST', `/customers/${customerId}/preferences`, payload);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Preference }).data;
  }

  async function errorOf(response: Response, status: number): Promise<ApiError['error']> {
    assert.equal(response.status, status);
    return ((await response.json()) as ApiError).error;
  }

  async function auditActions(customerId: string): Promise<{ action: string; changes: unknown }[]> {
    return (await db.query(
      `SELECT action, changes FROM audit_logs
        WHERE entity_type = 'customer' AND entity_id = $1 ORDER BY created_at, id`,
      [customerId],
    )) as { action: string; changes: unknown }[];
  }

  describe('POST', () => {
    it('thêm nhu cầu đủ tiêu chí → 201; mảng bỏ trùng; mặc định SALE, đang bật; ghi nhật ký', async () => {
      const customerId = await createCustomer();
      const preference = await addPreference(customerId, {
        propertyTypes: ['HOUSE', 'APARTMENT', 'HOUSE'],
        budgetMin: 2_000_000_000,
        budgetMax: 4_500_000_000,
        areaMin: 50.5,
        areaMax: 120,
        bedroomsMin: 2,
        provinceIds: [khanhHoa],
        districtIds: [nhaTrang],
        wardIds: [vinhHai, vinhHai],
        directions: ['E', 'SE'],
        legalStatuses: ['PRIVATE_BOOK'],
        minRoadAccess: 'CAR',
      });
      assert.equal(preference.customerId, customerId);
      assert.equal(preference.transactionType, 'SALE');
      assert.equal(preference.isActive, true);
      assert.deepEqual(preference.propertyTypes, ['HOUSE', 'APARTMENT']);
      assert.equal(preference.budgetMin, 2_000_000_000);
      assert.equal(preference.budgetMax, 4_500_000_000);
      assert.equal(preference.areaMin, 50.5);
      assert.equal(preference.areaMax, 120);
      assert.equal(preference.bedroomsMin, 2);
      assert.deepEqual(preference.provinceIds, [khanhHoa]);
      assert.deepEqual(preference.districtIds, [nhaTrang]);
      assert.deepEqual(preference.wardIds, [vinhHai]);
      assert.deepEqual(preference.directions, ['E', 'SE']);
      assert.deepEqual(preference.legalStatuses, ['PRIVATE_BOOK']);
      assert.equal(preference.minRoadAccess, 'CAR');
      assert.equal('tenantId' in preference, false);

      const [row] = (await db.query('SELECT tenant_id FROM customer_preferences WHERE id = $1', [
        preference.id,
      ])) as { tenant_id: string }[];
      assert.equal(row?.tenant_id, tenantA);
      const audit = await auditActions(customerId);
      assert.deepEqual(audit.at(-1), {
        action: 'customer.add_preference',
        changes: { preferenceId: [null, preference.id] },
      });
    });

    it('chỉ một tiêu chí, thuê, đang tắt: các tiêu chí khác null; mảng rỗng coi như không đặt', async () => {
      const customerId = await createCustomer();
      const preference = await addPreference(customerId, {
        transactionType: 'RENT',
        isActive: false,
        bedroomsMin: 1,
        directions: [],
      });
      assert.equal(preference.transactionType, 'RENT');
      assert.equal(preference.isActive, false);
      assert.equal(preference.directions, null);
      assert.equal(preference.propertyTypes, null);
      assert.equal(preference.budgetMin, null);
    });

    it('dữ liệu sai → 400 kèm trường lỗi', async () => {
      const customerId = await createCustomer();
      for (const [payload, field] of [
        [{ propertyTypes: ['CASTLE'] }, 'propertyTypes'],
        [{ propertyTypes: 'HOUSE' }, 'propertyTypes'],
        [{ budgetMin: -1 }, 'budgetMin'],
        [{ budgetMax: 1.5 }, 'budgetMax'],
        [{ budgetMin: 5, budgetMax: 4 }, 'budgetMax'],
        [{ areaMin: 100, areaMax: 50 }, 'areaMax'],
        [{ areaMin: 1.234 }, 'areaMin'],
        [{ bedroomsMin: -1 }, 'bedroomsMin'],
        [{ provinceIds: ['abc'] }, 'provinceIds'],
        [{ provinceIds: [MISSING] }, 'provinceIds'],
        [{ provinceIds: [oldProvince] }, 'provinceIds'],
        [{ districtIds: [khanhHoa] }, 'districtIds'],
        [{ wardIds: [nhaTrang] }, 'wardIds'],
        [
          {
            wardIds: Array.from(
              { length: 51 },
              (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            ),
          },
          'wardIds',
        ],
        [{ directions: ['UP'] }, 'directions'],
        [{ legalStatuses: ['NONE'] }, 'legalStatuses'],
        [{ minRoadAccess: 'BOAT' }, 'minRoadAccess'],
        [{ bedroomsMin: 1, transactionType: 'LEASE' }, 'transactionType'],
        [{ bedroomsMin: 1, isActive: 'yes' }, 'isActive'],
        [{ bedroomsMin: 1, customerId }, 'customerId'],
        [{ bedroomsMin: 1, tenantId: tenantA }, 'tenantId'],
      ] as const) {
        const error = await errorOf(
          await as('agent1', 'POST', `/customers/${customerId}/preferences`, payload),
          400,
        );
        assert.ok(
          error.details?.some((detail) => detail.field === field),
          `${field}: ${JSON.stringify(error.details)}`,
        );
      }
    });

    it('không có tiêu chí nào → 400', async () => {
      const customerId = await createCustomer();
      for (const payload of [{}, { transactionType: 'RENT' }, { propertyTypes: [] }]) {
        assert.equal(
          (await as('agent1', 'POST', `/customers/${customerId}/preferences`, payload)).status,
          400,
          JSON.stringify(payload),
        );
      }
    });

    it(`tối đa ${MAX_PREFERENCES_PER_CUSTOMER} nhu cầu mỗi khách → 422; xoá bớt thì thêm được`, async () => {
      const customerId = await createCustomer();
      const added: Preference[] = [];
      for (let i = 0; i < MAX_PREFERENCES_PER_CUSTOMER; i += 1) {
        added.push(await addPreference(customerId, { bedroomsMin: i }));
      }
      const error = await errorOf(
        await as('agent1', 'POST', `/customers/${customerId}/preferences`, { bedroomsMin: 1 }),
        422,
      );
      assert.equal(error.code, 'BUSINESS_RULE_VIOLATION');
      assert.equal(
        (await as('agent1', 'DELETE', `/customers/${customerId}/preferences/${added[0]?.id}`))
          .status,
        204,
      );
      await addPreference(customerId, { bedroomsMin: 1 });
    });

    it('quyền: trưởng nhóm thêm được; không sửa được khách → 403; không xem được khách → 404', async () => {
      const customerId = await createCustomer();
      await addPreference(customerId, { bedroomsMin: 3 }, 'leader');
      const payload = { bedroomsMin: 1 };
      assert.equal(
        (
          await errorOf(
            await as('viewer', 'POST', `/customers/${customerId}/preferences`, payload),
            403,
          )
        ).code,
        'FORBIDDEN',
      );
      assert.equal(
        (await as('agent2', 'POST', `/customers/${customerId}/preferences`, payload)).status,
        404,
      );
      assert.equal(
        (
          await request(
            'POST',
            `/customers/${customerId}/preferences`,
            payload,
            tokens['otherAdmin'],
          )
        ).status,
        404,
      );
      assert.equal(
        (await as('agent1', 'POST', `/customers/${MISSING}/preferences`, payload)).status,
        404,
      );
      assert.equal((await as('agent1', 'POST', '/customers/abc/preferences', payload)).status, 400);
      assert.equal(
        (await request('POST', `/customers/${customerId}/preferences`, payload)).status,
        401,
      );
    });
  });

  describe('GET', () => {
    it('danh sách nhu cầu của khách (kể cả đang tắt), tạo trước đứng trước; không gồm khách khác', async () => {
      const customerId = await createCustomer();
      const first = await addPreference(customerId, { bedroomsMin: 1 });
      const second = await addPreference(customerId, { bedroomsMin: 2, isActive: false });
      const otherCustomer = await createCustomer();
      await addPreference(otherCustomer, { bedroomsMin: 9 });

      for (const user of ['agent1', 'leader', 'viewer', 'admin']) {
        const response = await as(user, 'GET', `/customers/${customerId}/preferences`);
        assert.equal(response.status, 200, user);
        const data = ((await response.json()) as { data: Preference[] }).data;
        assert.deepEqual(
          data.map((item) => item.id),
          [first.id, second.id],
          user,
        );
      }
    });

    it('không xem được khách, công ty khác, khách đã xoá → 404', async () => {
      const customerId = await createCustomer();
      await addPreference(customerId);
      assert.equal((await as('agent2', 'GET', `/customers/${customerId}/preferences`)).status, 404);
      assert.equal(
        (
          await request(
            'GET',
            `/customers/${customerId}/preferences`,
            undefined,
            tokens['otherAdmin'],
          )
        ).status,
        404,
      );
      assert.equal((await as('admin', 'DELETE', `/customers/${customerId}`)).status, 204);
      assert.equal((await as('admin', 'GET', `/customers/${customerId}/preferences`)).status, 404);
      const [row] = (await db.query(
        'SELECT count(*)::int AS n FROM customer_preferences WHERE customer_id = $1 AND deleted_at IS NULL',
        [customerId],
      )) as { n: number }[];
      assert.equal(row?.n, 1, 'nhu cầu vẫn giữ trong database');
    });
  });

  describe('PATCH /:id', () => {
    it('sửa trường được gửi → 200; null bỏ tiêu chí; ghi nhật ký thay đổi', async () => {
      const customerId = await createCustomer();
      const preference = await addPreference(customerId);
      const response = await as(
        'agent1',
        'PATCH',
        `/customers/${customerId}/preferences/${preference.id}`,
        {
          budgetMax: null,
          budgetMin: 1_000_000_000,
          wardIds: [vinhHai],
          isActive: false,
          expectedUpdatedAt: preference.updatedAt,
        },
      );
      assert.equal(response.status, 200);
      const updated = ((await response.json()) as { data: Preference }).data;
      assert.equal(updated.budgetMax, null);
      assert.equal(updated.budgetMin, 1_000_000_000);
      assert.deepEqual(updated.wardIds, [vinhHai]);
      assert.equal(updated.isActive, false);
      assert.deepEqual(updated.propertyTypes, ['HOUSE']);

      const audit = await auditActions(customerId);
      assert.deepEqual(audit.at(-1), {
        action: 'customer.update_preference',
        changes: {
          preferenceId: [preference.id, preference.id],
          isActive: [true, false],
          budgetMin: [null, 1_000_000_000],
          budgetMax: [5_000_000_000, null],
          wardIds: [null, [vinhHai]],
        },
      });
    });

    it('min > max sau khi gộp, bỏ hết tiêu chí, khu vực không tồn tại, body rỗng → 400', async () => {
      const customerId = await createCustomer();
      const preference = await addPreference(customerId, { budgetMin: 3_000_000_000 });
      const path = `/customers/${customerId}/preferences/${preference.id}`;
      for (const payload of [
        { budgetMax: 1_000_000_000 },
        { budgetMin: null },
        { provinceIds: [MISSING] },
        {},
        { transactionType: null },
        { isActive: null },
        { customerId: MISSING },
      ]) {
        assert.equal(
          (await as('agent1', 'PATCH', path, payload)).status,
          400,
          JSON.stringify(payload),
        );
      }
    });

    it('expectedUpdatedAt cũ → 409', async () => {
      const customerId = await createCustomer();
      const preference = await addPreference(customerId);
      const path = `/customers/${customerId}/preferences/${preference.id}`;
      assert.equal((await as('agent1', 'PATCH', path, { bedroomsMin: 1 })).status, 200);
      assert.equal(
        (
          await errorOf(
            await as('agent1', 'PATCH', path, {
              bedroomsMin: 2,
              expectedUpdatedAt: preference.updatedAt,
            }),
            409,
          )
        ).code,
        'CONFLICT',
      );
    });

    it('nhu cầu của khách khác hoặc không tồn tại → 404; không sửa được khách → 403', async () => {
      const customerId = await createCustomer();
      const otherCustomer = await createCustomer();
      const preference = await addPreference(otherCustomer);
      assert.equal(
        (
          await as('agent1', 'PATCH', `/customers/${customerId}/preferences/${preference.id}`, {
            bedroomsMin: 1,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await as('agent1', 'PATCH', `/customers/${customerId}/preferences/${MISSING}`, {
            bedroomsMin: 1,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await as('viewer', 'PATCH', `/customers/${otherCustomer}/preferences/${preference.id}`, {
            bedroomsMin: 1,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await as('agent2', 'PATCH', `/customers/${otherCustomer}/preferences/${preference.id}`, {
            bedroomsMin: 1,
          })
        ).status,
        404,
      );
    });
  });

  describe('DELETE /:id', () => {
    it('xoá mềm → 204; không còn trong danh sách; xoá lần hai → 404; ghi nhật ký', async () => {
      const customerId = await createCustomer();
      const preference = await addPreference(customerId);
      const path = `/customers/${customerId}/preferences/${preference.id}`;
      const response = await as('agent1', 'DELETE', path);
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');
      const [row] = (await db.query('SELECT deleted_at FROM customer_preferences WHERE id = $1', [
        preference.id,
      ])) as { deleted_at: Date | null }[];
      assert.ok(row?.deleted_at);
      const list = (await (
        await as('agent1', 'GET', `/customers/${customerId}/preferences`)
      ).json()) as {
        data: Preference[];
      };
      assert.deepEqual(list.data, []);
      assert.equal((await as('agent1', 'DELETE', path)).status, 404);
      assert.deepEqual((await auditActions(customerId)).at(-1), {
        action: 'customer.remove_preference',
        changes: { preferenceId: [preference.id, null] },
      });
    });

    it('không sửa được khách → 403; không xem được → 404; nhu cầu của khách khác → 404', async () => {
      const customerId = await createCustomer();
      const preference = await addPreference(customerId);
      const path = `/customers/${customerId}/preferences/${preference.id}`;
      assert.equal((await as('viewer', 'DELETE', path)).status, 403);
      assert.equal((await as('agent2', 'DELETE', path)).status, 404);
      const otherCustomer = await createCustomer();
      assert.equal(
        (await as('agent1', 'DELETE', `/customers/${otherCustomer}/preferences/${preference.id}`))
          .status,
        404,
      );
      assert.equal((await as('leader', 'DELETE', path)).status, 204);
    });
  });
});
