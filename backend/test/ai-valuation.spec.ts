import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  clampAdjustment,
  differencePercent,
  percentile,
  roundMillion,
  valuationBase,
  valuationConfidence,
} from '../src/ai/valuation.js';
import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { type FakeLlm, setEnv, startFakeLlm } from './support/fake-llm.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const MISSING = '00000000-0000-4000-8000-000000000000';
const MILLION = 1_000_000;
const BILLION = 1_000_000_000;
const STREET = 'Số 12 đường Trần Phú';
const DESCRIPTION = 'Nhà mới xây, gần chợ Vĩnh Hải. Chủ nhà gọi 0912 345 678.';

function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'property_valuation', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 900, output_tokens: 300 },
    },
  };
}

describe('Tính toán định giá (TASK-149)', () => {
  it('percentile nội suy tuyến tính như percentile_cont', () => {
    assert.equal(percentile([10], 0.5), 10);
    assert.equal(percentile([50, 55, 60, 70], 0.5), 57.5);
    assert.equal(percentile([50, 55, 60, 70], 0.25), 53.75);
    assert.equal(percentile([50, 55, 60, 70], 0.75), 62.5);
    assert.throws(() => percentile([], 0.5));
  });

  it('giá gốc = giá/m² trung vị × diện tích, khoảng giá p25..p75', () => {
    const base = valuationBase([70, 50, 60, 55], 80);
    assert.deepEqual(
      { ...base, spread: Math.round(base.spread * 1000) / 1000 },
      { pricePerM2: 57.5, price: 4600, low: 4300, high: 5000, spread: 0.152 },
    );
  });

  it('độ tin cậy theo số BĐS tương tự và độ phân tán', () => {
    assert.equal(valuationConfidence(8, 0.25), 'HIGH');
    assert.equal(valuationConfidence(8, 0.3), 'MEDIUM');
    assert.equal(valuationConfidence(7, 0.1), 'MEDIUM');
    assert.equal(valuationConfidence(5, 0.5), 'MEDIUM');
    assert.equal(valuationConfidence(5, 0.51), 'LOW');
    assert.equal(valuationConfidence(4, 0), 'LOW');
  });

  it('mức AI chỉnh kẹp trong ±10%, không phải số thì 0', () => {
    assert.equal(clampAdjustment(25), 10);
    assert.equal(clampAdjustment(-30), -10);
    assert.equal(clampAdjustment(3.14), 3.1);
    assert.equal(clampAdjustment(-0.01), 0);
    assert.equal(clampAdjustment('5'), 0);
    assert.equal(clampAdjustment(Number.NaN), 0);
    assert.equal(clampAdjustment(undefined), 0);
    assert.equal(clampAdjustment(15, 20), 15);
    assert.equal(clampAdjustment(5, 0), 0);
  });

  it('làm tròn triệu, chênh lệch giá chào bán', () => {
    assert.equal(roundMillion(4_604_500_000), 4_605_000_000);
    assert.equal(differencePercent(5_000, 5_060), -1.2);
    assert.equal(differencePercent(5_500, 5_000), 10);
    assert.equal(differencePercent(1, 0), null);
  });
});

/**
 * Công ty A (phường Vĩnh Hải, Lộc Thọ, Phước Long): BĐS cần định giá `house` (80 m², 5 tỷ) và 4 BĐS tương tự
 * (giá/m² 50, 60, 55 triệu cùng phường; 70 triệu ở Lộc Thọ cách ~0,6 km), cùng các BĐS không được tính (xa, diện tích
 * quá lớn, khác loại, đã ẩn). Công ty B: một nhà cùng phường. `own` chỉ xem BĐS mình phụ trách (house, c1).
 */
describe('Định giá AI POST /api/v1/properties/:id/ai-valuation (TASK-149)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let house: string;
  let otherHouse: string;
  const comparables: string[] = [];
  const tokens: Record<string, string> = {};

  before(async () => {
    llm = await startFakeLlm();
    restoreEnv = setEnv({ AI_API_KEY: 'sk-test', AI_BASE_URL: llm.url });
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    db = app.get(DataSource);

    const khanhHoa = await insertId(
      `INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`,
    );
    const ward = async (code: string, name: string) =>
      insertId(`INSERT INTO wards (province_id, code, name) VALUES ($1, $2, $3)`, [
        khanhHoa,
        code,
        name,
      ]);
    const vinhHai = await ward('22330', 'Vĩnh Hải');
    const locTho = await ward('22366', 'Lộc Thọ');
    const phuocLong = await ward('22402', 'Phước Long');

    const tenantA = await register('admin@a.vn');
    tokens['admin'] = await login('admin@a.vn');
    const hash = await hashPassword(PASSWORD);
    const own = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'own@a.vn', $2, 'Own')`,
      [tenantA, hash],
    );
    await db.query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [
      own,
      await role(tenantA, 'OWN_VIEWER', 'property.view', 'OWN'),
      tenantA,
    ]);
    tokens['own'] = await login('own@a.vn');
    const noView = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'noview@a.vn', $2, 'No view')`,
      [tenantA, hash],
    );
    await db.query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [
      noView,
      await role(tenantA, 'CUSTOMER_ONLY', 'customer.view', 'COMPANY'),
      tenantA,
    ]);
    tokens['noView'] = await login('noview@a.vn');
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');

    const create = async (token: string, overrides: Record<string, unknown>) => {
      const response = await request(
        'POST',
        '/properties',
        {
          title: 'Nhà phố',
          propertyType: 'HOUSE',
          price: 4 * BILLION,
          area: 80,
          provinceId: khanhHoa,
          wardId: vinhHai,
          ...overrides,
        },
        token,
      );
      assert.equal(response.status, 201, await response.clone().text());
      return ((await response.json()) as { data: { id: string } }).data.id;
    };
    const admin = tokens['admin'] as string;
    house = await create(admin, {
      title: 'Nhà phố Vĩnh Hải',
      description: DESCRIPTION,
      streetAddress: STREET,
      price: 5 * BILLION,
      direction: 'SE',
      legalStatus: 'PRIVATE_BOOK',
      roadAccess: 'CAR',
      latitude: 12.27,
      longitude: 109.2,
    });
    comparables.push(
      await create(admin, { title: 'Nhà 0912345678', price: 4 * BILLION, area: 80 }),
      await create(admin, { price: 6 * BILLION, area: 100, legalStatus: 'SHARED_BOOK' }),
      await create(admin, { price: 3.3 * BILLION, area: 60 }),
      await create(admin, {
        price: 6.3 * BILLION,
        area: 90,
        wardId: locTho,
        latitude: 12.275,
        longitude: 109.2,
      }),
    );
    // Không được tính: khác phường và xa ~80 km, diện tích 2,5 lần, khác loại, đã ẩn.
    await create(admin, { wardId: phuocLong, latitude: 13, longitude: 109.2 });
    await create(admin, { area: 200, price: 2 * BILLION });
    await create(admin, { propertyType: 'APARTMENT', price: 1 * BILLION });
    const hidden = await create(admin, { price: 1 * BILLION });
    await db.query(`UPDATE properties SET status = 'HIDDEN' WHERE id = $1`, [hidden]);
    otherHouse = await create(tokens['otherAdmin'] as string, {
      wardId: vinhHai,
      provinceId: khanhHoa,
    });

    await db.query(`UPDATE properties SET agent_id = $1 WHERE id = ANY($2::uuid[])`, [
      own,
      [house, comparables[0]],
    ]);
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.reply = toolReply({
      adjustmentPercent: 25,
      factors: [
        { factor: 'Pháp lý', impact: 'UP', note: 'Sổ riêng, tốt hơn căn sổ chung.' },
        { factor: 'Đường vào', impact: 'SIDEWAYS', note: 'Ô tô vào được, gọi 0912 345 678.' },
        { factor: '', impact: 'DOWN', note: 'Không tên, bị bỏ.' },
      ],
      summary: '  Giá ước tính dựa trên 4 BĐS tương tự.\nPháp lý tốt nên chỉnh tăng.  ',
    });
  });

  after(async () => {
    await app.close();
    await llm.close();
    restoreEnv();
  });

  async function insertId(sql: string, params: unknown[] = []): Promise<string> {
    const [row] = (await db.query(`${sql} RETURNING id`, params)) as { id: string }[];
    assert.ok(row);
    return row.id;
  }

  async function role(tenantId: string, code: string, permission: string, scope: string) {
    const id = await insertId(`INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2)`, [
      tenantId,
      code,
    ]);
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, scope)
       SELECT $1, id, $3 FROM permissions WHERE code = $2`,
      [id, permission, scope],
    );
    return id;
  }

  async function register(email: string): Promise<string> {
    const response = await request('POST', '/auth/register', {
      companyName: `Công ty ${email}`,
      fullName: 'Quản trị',
      email,
      password: PASSWORD,
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { company: { id: string } } }).data.company.id;
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

  function value(user: string | undefined, id = house): Promise<Response> {
    return request('POST', `/properties/${id}/ai-valuation`, undefined, user && tokens[user]);
  }

  it('giá gốc từ BĐS tương tự, AI chỉnh tối đa ±10%; LLM không nhận địa chỉ, toạ độ, giá chào bán, số điện thoại', async () => {
    const response = await value('admin');
    assert.equal(response.status, 200, await response.clone().text());
    const { data } = (await response.json()) as { data: Record<string, unknown> };
    const code = (data['property'] as { code: string }).code;
    const comparableRows = data['comparables'] as Record<string, unknown>[];
    assert.deepEqual(
      comparableRows.map((row) => [row['id'], row['pricePerM2'], row['sameWard'], row['status']]),
      [
        [comparables[0], 50 * MILLION, true, 'AVAILABLE'],
        [comparables[1], 60 * MILLION, true, 'AVAILABLE'],
        [comparables[2], 55 * MILLION, true, 'AVAILABLE'],
        [comparables[3], 70 * MILLION, false, 'AVAILABLE'],
      ],
    );
    assert.deepEqual(Object.keys(comparableRows[0] ?? {}).sort(), [
      'area',
      'code',
      'id',
      'price',
      'pricePerM2',
      'sameWard',
      'status',
      'title',
    ]);
    assert.deepEqual(
      Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'comparables')),
      {
        property: { id: house, code },
        estimate: { price: 5_060 * MILLION, pricePerM2: 63_250_000 },
        range: { low: 4_730 * MILLION, high: 5_500 * MILLION },
        base: { price: 4_600 * MILLION, pricePerM2: 57_500_000 },
        adjustmentPercent: 10,
        maxAdjustmentPercent: 10,
        confidence: 'LOW',
        factors: [
          { factor: 'Pháp lý', impact: 'UP', note: 'Sổ riêng, tốt hơn căn sổ chung.' },
          {
            factor: 'Đường vào',
            impact: 'NEUTRAL',
            note: 'Ô tô vào được, gọi [đã ẩn số điện thoại].',
          },
        ],
        summary: 'Giá ước tính dựa trên 4 BĐS tương tự. Pháp lý tốt nên chỉnh tăng.',
        askingPrice: 5 * BILLION,
        askingVsEstimatePercent: -1.2,
      },
    );

    assert.equal(llm.calls.length, 1);
    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'property_valuation' });
    assert.match(String(body['system']), /±10%/);
    const [message] = body['messages'] as { content: string }[];
    assert.ok(message);
    const facts = JSON.parse(message.content) as {
      bat_dong_san: Record<string, unknown>;
      mo_ta: string;
      bds_tuong_tu: Record<string, unknown>[];
      gia_goc: Record<string, unknown>;
    };
    assert.equal(facts.bat_dong_san['gia'], undefined);
    assert.equal(facts.bat_dong_san['gia_m2'], undefined);
    assert.equal(facts.bat_dong_san['tieu_de'], undefined);
    assert.equal(facts.bat_dong_san['phap_ly'], 'Sổ riêng');
    assert.equal(facts.bat_dong_san['khu_vuc'], 'Vĩnh Hải, Khánh Hòa');
    assert.equal(facts.mo_ta, 'Nhà mới xây, gần chợ Vĩnh Hải. Chủ nhà gọi [đã ẩn số điện thoại].');
    assert.equal(facts.bds_tuong_tu.length, 4);
    assert.deepEqual(
      facts.bds_tuong_tu.map((row) => [row['gia_m2'], row['cung_phuong'], row['phap_ly']]),
      [
        ['50 triệu/m²', true, null],
        ['60 triệu/m²', true, 'Sổ chung'],
        ['55 triệu/m²', true, null],
        ['70 triệu/m²', false, null],
      ],
    );
    assert.deepEqual(facts.gia_goc, {
      gia: '4,6 tỷ',
      gia_m2: '57,5 triệu/m²',
      khoang_gia: '4,3 tỷ – 5 tỷ',
      so_bds_tuong_tu: 4,
      gioi_han_chinh: '±10%',
    });
    assert.doesNotMatch(message.content, /Trần Phú|0912|345 678|12\.27|109\.2/);

    const [row] = (await db.query(
      `SELECT feature, status FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string }[];
    assert.deepEqual(row, { feature: 'valuation', status: 'SUCCESS' });

    // Chỉ là tham khảo: BĐS không đổi giá.
    const [property] = (await db.query(`SELECT price FROM properties WHERE id = $1`, [house])) as {
      price: string;
    }[];
    assert.equal(Number(property?.price), 5 * BILLION);
  });

  it('chỉ dùng BĐS trong phạm vi xem và cùng công ty: dưới 3 BĐS tương tự → 422, không gọi AI', async () => {
    const own = await value('own');
    assert.equal(own.status, 422, await own.clone().text());
    const body = (await own.json()) as { message: string; error: { code: string } };
    assert.equal(body.error.code, 'BUSINESS_RULE_VIOLATION');
    assert.match(body.message, /cần ít nhất 3, có 1/);

    const other = await value('otherAdmin', otherHouse);
    assert.equal(other.status, 422);
    assert.match(((await other.json()) as { message: string }).message, /có 0\)/);
    assert.equal(llm.calls.length, 0);
  });

  it('BĐS công ty khác hoặc không tồn tại → 404; không có property.view → 403; chưa đăng nhập → 401; id sai → 400', async () => {
    assert.equal((await value('otherAdmin')).status, 404);
    assert.equal((await value('admin', MISSING)).status, 404);
    assert.equal((await value('noView')).status, 403);
    assert.equal((await value(undefined)).status, 401);
    assert.equal((await value('admin', 'abc')).status, 400);
    assert.equal(llm.calls.length, 0);
  });

  it('AI không trả nhận xét → 503; không trả mức chỉnh hợp lệ → giữ giá gốc', async () => {
    llm.reply = toolReply({ adjustmentPercent: 5, factors: [], summary: '   ' });
    assert.equal((await value('admin')).status, 503);

    llm.reply = toolReply({ adjustmentPercent: 'cao', factors: 'x', summary: 'Theo giá khu vực.' });
    const response = await value('admin');
    assert.equal(response.status, 200);
    const { data } = (await response.json()) as {
      data: { adjustmentPercent: number; estimate: { price: number }; factors: unknown[] };
    };
    assert.equal(data.adjustmentPercent, 0);
    assert.equal(data.estimate.price, 4_600 * MILLION);
    assert.deepEqual(data.factors, []);
  });
});
