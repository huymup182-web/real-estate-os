import 'reflect-metadata';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { DataSource } from 'typeorm';

import { createApp } from '../src/app.factory.js';
import { SLUG_MAX_LENGTH, toCompanySlug } from '../src/auth/company-slug.js';
import { DEFAULT_ROLE_MATRIX, DEFAULT_ROLES } from '../src/auth/default-roles.js';
import { useTestDatabase } from './support/test-database.js';

const PASSWORD = 'mat-khau-dung-8';

interface ApiBody {
  success: boolean;
  data: {
    user: { id: string; fullName: string; email: string | null; phone: string | null };
    company: { id: string; name: string; slug: string };
  } | null;
  error?: { code: string; details?: { field?: string; message: string }[] };
}

describe('POST /api/v1/auth/register', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;

  before(async () => {
    await useTestDatabase();
    app = await createApp();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth/register`;
    db = app.get(DataSource);
  });

  after(async () => {
    await app.close();
  });

  async function register(
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: ApiBody; raw: string }> {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as ApiBody, raw };
  }

  async function countCompanies(): Promise<number> {
    const rows: { count: string }[] = await db.query('SELECT count(*) FROM companies');
    return Number(rows[0]?.count);
  }

  function fields(body: ApiBody): (string | undefined)[] {
    return (body.error?.details ?? []).map((detail) => detail.field);
  }

  it('tạo công ty, 6 role mặc định, tài khoản admin; không trả mật khẩu', async () => {
    const result = await register({
      companyName: '  Công ty BĐS An Phát  ',
      fullName: 'Nguyễn Văn An',
      email: 'an@anphat.test',
      phone: '+84901000001',
      password: PASSWORD,
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.success, true);
    const data = result.body.data;
    assert.ok(data);
    assert.deepEqual(data.company.name, 'Công ty BĐS An Phát');
    assert.equal(data.company.slug, 'cong-ty-bds-an-phat');
    assert.deepEqual(
      { ...data.user, id: undefined },
      { id: undefined, fullName: 'Nguyễn Văn An', email: 'an@anphat.test', phone: '+84901000001' },
    );
    assert.ok(!/password|mat-khau/i.test(result.raw));

    const [company] = await db.query('SELECT status FROM companies WHERE id = $1', [
      data.company.id,
    ]);
    assert.equal(company.status, 'ACTIVE');

    const [user] = await db.query(
      'SELECT tenant_id, status, password_hash FROM users WHERE id = $1',
      [data.user.id],
    );
    assert.equal(user.tenant_id, data.company.id);
    assert.equal(user.status, 'ACTIVE');
    assert.match(user.password_hash, /^\$argon2id\$/);
    assert.equal(await verify(user.password_hash, PASSWORD), true);

    const roles: { code: string; is_system: boolean }[] = await db.query(
      'SELECT code, is_system FROM roles WHERE tenant_id = $1 ORDER BY code',
      [data.company.id],
    );
    assert.deepEqual(
      roles.map((role) => role.code),
      DEFAULT_ROLES.map(([code]) => code).sort(),
    );
    assert.ok(roles.every((role) => role.is_system));

    const userRoles: { code: string }[] = await db.query(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [data.user.id],
    );
    assert.deepEqual(userRoles, [{ code: 'COMPANY_ADMIN' }]);

    const grants: { role: string; permission: string; scope: string }[] = await db.query(
      `SELECT r.code AS role, p.code AS permission, rp.scope
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.tenant_id = $1`,
      [data.company.id],
    );
    const expected = Object.entries(DEFAULT_ROLE_MATRIX).flatMap(([permission, scopes]) =>
      scopes.flatMap((scope, index) =>
        scope ? [`${DEFAULT_ROLES[index]?.[0]}|${permission}|${scope}`] : [],
      ),
    );
    assert.deepEqual(
      grants.map((g) => `${g.role}|${g.permission}|${g.scope}`).sort(),
      expected.sort(),
    );
  });

  it('chỉ cần email hoặc số điện thoại', async () => {
    const phoneOnly = await register({
      companyName: 'Công ty Chỉ SĐT',
      fullName: 'Trần B',
      phone: '+84901000002',
      password: PASSWORD,
    });
    assert.equal(phoneOnly.status, 201);
    assert.equal(phoneOnly.body.data?.user.email, null);

    const neither = await register({
      companyName: 'X',
      fullName: 'Y',
      email: '  ',
      password: PASSWORD,
    });
    assert.equal(neither.status, 400);
    assert.deepEqual(fields(neither.body), ['email']);
  });

  it('email hoặc SĐT đã dùng → 409, báo đúng trường, không tạo công ty', async () => {
    const before = await countCompanies();
    const duplicate = await register({
      companyName: 'Công ty Trùng',
      fullName: 'C',
      email: 'AN@ANPHAT.TEST',
      phone: '+84901000002',
      password: PASSWORD,
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error?.code, 'CONFLICT');
    assert.deepEqual(fields(duplicate.body).sort(), ['email', 'phone']);
    assert.equal(await countCompanies(), before);
  });

  it('hai request cùng email chạy đồng thời: chỉ một thành công, không để lại công ty thừa', async () => {
    const before = await countCompanies();
    const payload = (index: number): Record<string, unknown> => ({
      companyName: `Công ty Đồng Thời ${index}`,
      fullName: 'D',
      email: 'race@test.vn',
      password: PASSWORD,
    });
    // Bắt mọi thứ in ra stdout/stderr: lỗi truy vấn không được làm lộ mật khẩu đã băm.
    const printed: string[] = [];
    const originals = { stdout: process.stdout.write, stderr: process.stderr.write };
    for (const stream of ['stdout', 'stderr'] as const) {
      const original = originals[stream];
      process[stream].write = ((chunk: unknown, ...rest: unknown[]): boolean => {
        printed.push(String(chunk));
        return (original as (...args: unknown[]) => boolean).call(process[stream], chunk, ...rest);
      }) as typeof process.stdout.write;
    }
    let results: Awaited<ReturnType<typeof register>>[];
    try {
      results = await Promise.all([
        register(payload(1)),
        register(payload(2)),
        register(payload(3)),
      ]);
    } finally {
      process.stdout.write = originals.stdout;
      process.stderr.write = originals.stderr;
    }
    assert.ok(!printed.join('').includes('$argon2id'), 'không in mật khẩu đã băm ra log');
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal(await countCompanies(), before + 1);
  });

  it('tên công ty trùng → slug có hậu tố riêng', async () => {
    const first = await register({
      companyName: 'Đất Xanh',
      fullName: 'E',
      email: 'e1@test.vn',
      password: PASSWORD,
    });
    const second = await register({
      companyName: 'Đất Xanh',
      fullName: 'E',
      email: 'e2@test.vn',
      password: PASSWORD,
    });
    assert.equal(first.body.data?.company.slug, 'dat-xanh');
    assert.match(second.body.data?.company.slug ?? '', /^dat-xanh-[0-9a-f]{6}$/);
  });

  it('dữ liệu sai → 400 kèm lỗi theo trường', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ companyName: 'A', fullName: 'B', email: 'f@test.vn', password: 'ngan' }, 'password'],
      [
        { companyName: '<b>A</b>', fullName: 'B', email: 'f@test.vn', password: PASSWORD },
        'companyName',
      ],
      [
        { companyName: '   ', fullName: 'B', email: 'f@test.vn', password: PASSWORD },
        'companyName',
      ],
      [{ companyName: 'A', fullName: 'B', phone: '0901234567', password: PASSWORD }, 'phone'],
      [{ companyName: 'A', fullName: 'B', email: 'khong-phai-email', password: PASSWORD }, 'email'],
      [
        { companyName: 'A', fullName: 'B', email: 'f@test.vn', password: PASSWORD, tenantId: 'x' },
        'tenantId',
      ],
      [
        {
          companyName: 'A',
          fullName: 'B',
          email: 'f@test.vn',
          password: PASSWORD,
          role: 'SUPER_ADMIN',
        },
        'role',
      ],
    ];
    const before = await countCompanies();
    for (const [payload, field] of cases) {
      const result = await register(payload);
      assert.equal(result.status, 400, field);
      assert.ok(fields(result.body).includes(field), `${field}: ${result.raw}`);
      assert.ok(!result.raw.includes(PASSWORD));
    }
    assert.equal(await countCompanies(), before);
  });
});

describe('Ma trận role mặc định', () => {
  it('khớp với ma trận trong database/src/seed.ts', async () => {
    const seed = (await import(
      pathToFileURL(resolve(process.cwd(), '../database/src/seed.ts')).href
    )) as { DEFAULT_ROLE_MATRIX: unknown };
    assert.deepEqual(DEFAULT_ROLE_MATRIX, seed.DEFAULT_ROLE_MATRIX);
  });
});

describe('toCompanySlug', () => {
  it('bỏ dấu tiếng Việt, chữ thường, nối bằng dấu gạch', () => {
    assert.equal(toCompanySlug('Công ty BĐS Đất Xanh Miền Nam'), 'cong-ty-bds-dat-xanh-mien-nam');
    assert.equal(toCompanySlug('  ABC & Partners, Ltd.  '), 'abc-partners-ltd');
  });

  it('tên không có chữ/số thì dùng mặc định; tên dài bị cắt vẫn hợp lệ', () => {
    assert.equal(toCompanySlug('!!! ???'), 'cong-ty');
    const slug = toCompanySlug('Công ty '.repeat(40));
    assert.ok(slug.length <= SLUG_MAX_LENGTH - 7);
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
