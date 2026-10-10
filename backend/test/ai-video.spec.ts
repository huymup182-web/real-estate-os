import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { buildScenes } from '../src/ai/video.js';
import { createApp } from '../src/app.factory.js';
import { hashPassword } from '../src/auth/password.js';
import { StorageService } from '../src/storage/storage.service.js';
import { type FakeLlm, setEnv, startFakeLlm } from './support/fake-llm.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';
const MISSING = '00000000-0000-4000-8000-000000000000';
const STREET = 'Số 12 đường Trần Phú';
const DESCRIPTION = 'Nhà mới xây, gần chợ Vĩnh Hải, sân để ô tô. Chủ nhà gọi 0912 345 678.';

function toolReply(input: Record<string, unknown>): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'property_video', input }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 500, output_tokens: 200 },
    },
  };
}

const TEXTS = { hook: 'Mở đầu', highlights: ['A', 'B', 'C'], cta: 'Mời', facts: ['Giá 5 tỷ'] };
const IMAGES = [
  { id: 'i1', url: 'u1' },
  { id: 'i2', url: 'u2' },
];

describe('Dựng cảnh video (TASK-150)', () => {
  it('mở đầu, nổi bật, thông tin, lời mời; ảnh quay vòng; tổng đúng độ dài', () => {
    const scenes = buildScenes(IMAGES, 30, TEXTS);
    assert.deepEqual(
      scenes.map((scene) => [scene.kind, scene.imageId, scene.title, scene.durationSeconds]),
      [
        ['INTRO', 'i1', 'Mở đầu', 5],
        ['HIGHLIGHT', 'i2', 'A', 5],
        ['HIGHLIGHT', 'i1', 'B', 5],
        ['HIGHLIGHT', 'i2', 'C', 5],
        ['FACTS', 'i1', 'Thông tin', 5],
        ['CTA', 'i2', 'Mời', 5],
      ],
    );
    assert.deepEqual(scenes[4]?.lines, ['Giá 5 tỷ']);
    assert.deepEqual(scenes[5]?.lines, ['Liên hệ để xem nhà']);
  });

  it('video 15 giây chỉ có 2 cảnh nổi bật (mỗi cảnh từ 3 giây), giây dư cho cảnh thông tin', () => {
    const scenes = buildScenes(IMAGES, 15, TEXTS);
    assert.deepEqual(
      scenes.map((scene) => [scene.kind, scene.durationSeconds]),
      [
        ['INTRO', 3],
        ['HIGHLIGHT', 3],
        ['HIGHLIGHT', 3],
        ['FACTS', 3],
        ['CTA', 3],
      ],
    );
    const long = buildScenes([{ id: 'i1', url: 'u1' }], 45, { ...TEXTS, highlights: [] });
    assert.deepEqual(
      long.map((scene) => [scene.kind, scene.imageId, scene.durationSeconds]),
      [
        ['INTRO', 'i1', 15],
        ['FACTS', 'i1', 15],
        ['CTA', 'i1', 15],
      ],
    );
    const odd = buildScenes(IMAGES, 60, {
      ...TEXTS,
      highlights: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    });
    assert.equal(odd.length, 9);
    assert.equal(
      odd.reduce((total, scene) => total + scene.durationSeconds, 0),
      60,
    );
    assert.equal(odd.find((scene) => scene.kind === 'FACTS')?.durationSeconds, 6 + 6);
    assert.throws(() => buildScenes([], 30, TEXTS));
  });
});

/** Công ty A: admin, `noView`; BĐS `house` có 3 ảnh, `bare` chưa có ảnh. Công ty B: `otherAdmin`. */
describe('Video AI POST /api/v1/properties/:id/ai-video (TASK-150)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let llm: FakeLlm;
  let restoreEnv: () => void;
  let house: string;
  let bare: string;
  let imageIds: string[];
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
    app.get(StorageService).readUrl = (key: string) => Promise.resolve(`https://cdn.test/${key}`);

    const khanhHoa = await insertId(
      `INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')`,
    );
    const vinhHai = await insertId(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, '22330', 'Vĩnh Hải')`,
      [khanhHoa],
    );
    const tenantA = await register('admin@a.vn');
    tokens['admin'] = await login('admin@a.vn');
    const noView = await insertId(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'noview@a.vn', $2, 'No view')`,
      [tenantA, await hashPassword(PASSWORD)],
    );
    await db.query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [
      noView,
      await role(tenantA, 'CUSTOMER_ONLY', 'customer.view', 'COMPANY'),
      tenantA,
    ]);
    tokens['noView'] = await login('noview@a.vn');
    await register('admin@b.vn');
    tokens['otherAdmin'] = await login('admin@b.vn');

    const create = async (overrides: Record<string, unknown>) => {
      const response = await request(
        'POST',
        '/properties',
        {
          title: 'Nhà phố Vĩnh Hải',
          propertyType: 'HOUSE',
          price: 5_000_000_000,
          area: 80,
          provinceId: khanhHoa,
          wardId: vinhHai,
          ...overrides,
        },
        tokens['admin'],
      );
      assert.equal(response.status, 201, await response.clone().text());
      return ((await response.json()) as { data: { id: string } }).data.id;
    };
    house = await create({
      description: DESCRIPTION,
      streetAddress: STREET,
      bedrooms: 3,
      legalStatus: 'PRIVATE_BOOK',
    });
    bare = await create({});
    const rows = (await db.query(
      `INSERT INTO property_images (tenant_id, property_id, storage_key, mime_type, size_bytes, sort_order, is_cover)
       SELECT $1::uuid, $2::uuid, $1::text || '/properties/' || $2::text || '/anh-' || n || '.jpg', 'image/jpeg', 1, n, n = 0
         FROM generate_series(0, 2) AS n
       RETURNING id`,
      [tenantA, house],
    )) as { id: string }[];
    imageIds = rows.map((row) => row.id);
  });

  beforeEach(() => {
    llm.calls.length = 0;
    llm.reply = toolReply({
      hook: '  Nhà phố   Vĩnh Hải #nhadep mới xây  ',
      highlights: ['3 phòng ngủ', '', 'Sân để ô tô, gọi 0912 345 678', 'Thừa'],
      cta: 'Nhắn tin để đi xem nhà ngay',
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

  function video(user: string | undefined, payload: unknown = {}, id = house): Promise<Response> {
    return request('POST', `/properties/${id}/ai-video`, payload, user && tokens[user]);
  }

  it('dựng cảnh từ ảnh thật; giá, diện tích, khu vực lấy từ database; LLM không nhận địa chỉ, số điện thoại', async () => {
    const response = await video('admin');
    assert.equal(response.status, 200, await response.clone().text());
    const { data } = (await response.json()) as {
      data: {
        property: { id: string };
        durationSeconds: number;
        scenes: {
          kind: string;
          imageId: string;
          imageUrl: string;
          durationSeconds: number;
          title: string;
          lines: string[];
        }[];
      };
    };
    assert.equal(data.property.id, house);
    assert.equal(data.durationSeconds, 30);
    assert.deepEqual(
      data.scenes.map((scene) => [scene.kind, scene.imageId, scene.title, scene.durationSeconds]),
      [
        ['INTRO', imageIds[0], 'Nhà phố Vĩnh Hải mới xây', 6],
        ['HIGHLIGHT', imageIds[1], '3 phòng ngủ', 6],
        ['HIGHLIGHT', imageIds[2], 'Sân để ô tô, gọi [đã ẩn số điện thoại]', 6],
        ['FACTS', imageIds[0], 'Thông tin', 6],
        ['CTA', imageIds[1], 'Nhắn tin để đi xem nhà ngay', 6],
      ],
    );
    assert.deepEqual(data.scenes[3]?.lines, [
      'Giá 5 tỷ',
      'Diện tích 80 m²',
      '3 phòng ngủ',
      'Sổ riêng',
      'Vĩnh Hải, Khánh Hòa',
    ]);
    assert.match(data.scenes[0]?.imageUrl ?? '', /anh-0\.jpg/);

    assert.equal(llm.calls.length, 1);
    const body = llm.calls[0]?.body ?? {};
    assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'property_video' });
    const [message] = body['messages'] as { content: string }[];
    assert.ok(message);
    const facts = JSON.parse(message.content) as { so_canh_anh: number; mo_ta: string };
    assert.equal(facts.so_canh_anh, 2);
    assert.match(facts.mo_ta, /\[đã ẩn số điện thoại\]/);
    assert.doesNotMatch(message.content, /Trần Phú|0912|345 678|anh-0/);

    const [row] = (await db.query(
      `SELECT feature, status FROM ai_requests ORDER BY created_at DESC LIMIT 1`,
    )) as { feature: string; status: string }[];
    assert.deepEqual(row, { feature: 'video', status: 'SUCCESS' });
  });

  it('chọn 15 giây: tổng 15 giây; độ dài khác 15/30/45/60 → 400', async () => {
    const response = await video('admin', { durationSeconds: 15 });
    assert.equal(response.status, 200);
    const { data } = (await response.json()) as {
      data: { durationSeconds: number; scenes: { durationSeconds: number }[] };
    };
    assert.equal(data.durationSeconds, 15);
    assert.equal(
      data.scenes.reduce((total, scene) => total + scene.durationSeconds, 0),
      15,
    );
    assert.equal((await video('admin', { durationSeconds: 20 })).status, 400);
  });

  it('BĐS chưa có ảnh → 422, không gọi AI; AI không trả câu mở đầu → 503', async () => {
    const response = await video('admin', {}, bare);
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { message: string }).message, /chưa có ảnh/);
    assert.equal(llm.calls.length, 0);

    llm.reply = toolReply({ hook: ' ', highlights: [], cta: 'Mời xem nhà' });
    assert.equal((await video('admin')).status, 503);
  });

  it('BĐS công ty khác hoặc không tồn tại → 404; không có property.view → 403; chưa đăng nhập → 401', async () => {
    assert.equal((await video('otherAdmin')).status, 404);
    assert.equal((await video('admin', {}, MISSING)).status, 404);
    assert.equal((await video('noView')).status, 403);
    assert.equal((await video(undefined)).status, 401);
    assert.equal(llm.calls.length, 0);
  });
});
