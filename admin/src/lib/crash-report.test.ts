import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCrashReport,
  CRASH_REPORT_LIMITS,
  crashRoute,
  crashThrottle,
  errorFields,
  sendCrashReport,
} from './crash-report.ts';

describe('crashRoute', () => {
  it('bỏ query, hash và đổi id thành [id]', () => {
    assert.equal(
      crashRoute('/properties/0b9c3c7e-8f6e-4a43-9a51-0a2b7c3d4e5f/edit?phone=0909123456#a'),
      '/properties/[id]/edit',
    );
    assert.equal(crashRoute('/deals/42'), '/deals/[id]');
    assert.equal(crashRoute('/'), '/');
  });

  it('không phải đường dẫn thì bỏ', () => {
    assert.equal(crashRoute('https://x.vn/a'), undefined);
    assert.equal(crashRoute(undefined), undefined);
    assert.equal(crashRoute(12), undefined);
  });
});

describe('buildCrashReport', () => {
  it('cắt độ dài, bỏ trường sai kiểu, gắn APP_VERSION hợp lệ', () => {
    const report = buildCrashReport(
      {
        name: 'TypeError',
        message: 'x'.repeat(CRASH_REPORT_LIMITS.message + 50),
        stack: 'TypeError: x\n    at A (a.js:1:2)',
        route: '/customers/7?q=Nguyen',
        digest: 123,
        fatal: 'yes',
      },
      { APP_VERSION: '1.2.0+abc' },
    );
    assert.equal(report.platform, 'admin');
    assert.equal(report.message.length, CRASH_REPORT_LIMITS.message);
    assert.equal(report.route, '/customers/[id]');
    assert.equal(report.appVersion, '1.2.0+abc');
    assert.equal('digest' in report, false);
    assert.equal('fatal' in report, false);
  });

  it('thiếu tên lỗi thì là Error; APP_VERSION sai định dạng thì bỏ', () => {
    const report = buildCrashReport({ message: 'a', fatal: true }, { APP_VERSION: '1.0 beta' });
    assert.deepEqual(report, { platform: 'admin', name: 'Error', message: 'a', fatal: true });
  });
});

describe('errorFields', () => {
  it('Error giữ tên, câu lỗi, stack; giá trị khác thành chuỗi', () => {
    const error = new RangeError('ngoài khoảng');
    assert.deepEqual(errorFields(error), {
      name: 'RangeError',
      message: 'ngoài khoảng',
      stack: error.stack,
    });
    assert.deepEqual(errorFields('hỏng'), { name: 'Error', message: 'hỏng' });
    assert.deepEqual(errorFields({ a: 1 }), { name: 'Error', message: '[object Object]' });
  });
});

describe('sendCrashReport', () => {
  const env = { API_INTERNAL_URL: 'http://backend:3000' };

  it('POST /crash-reports kèm token; 204 là thành công', async () => {
    let request: Request | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const ok = await sendCrashReport({ platform: 'admin', name: 'Error', message: 'a' }, 'tok', {
      fetchImpl,
      env,
    });
    assert.equal(ok, true);
    assert.equal(request?.method, 'POST');
    assert.equal(request?.url, 'http://backend:3000/api/v1/crash-reports');
    assert.equal(request?.headers.get('authorization'), 'Bearer tok');
    assert.deepEqual(await request?.json(), { platform: 'admin', name: 'Error', message: 'a' });
  });

  it('backend lỗi hoặc mất mạng: trả false, không ném lỗi', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    assert.equal(
      await sendCrashReport({ platform: 'admin', name: 'E', message: '' }, undefined, {
        fetchImpl: down,
        env,
      }),
      false,
    );
    const limited = (async () =>
      Response.json(
        { success: false, message: 'x', error: { code: 'RATE_LIMITED' } },
        { status: 429 },
      )) as typeof fetch;
    assert.equal(
      await sendCrashReport({ platform: 'admin', name: 'E', message: '' }, undefined, {
        fetchImpl: limited,
        env,
      }),
      false,
    );
  });
});

describe('crashThrottle', () => {
  it('mỗi lỗi một lần, tối đa max lỗi', () => {
    const allow = crashThrottle(2);
    assert.equal(allow('a'), true);
    assert.equal(allow('a'), false);
    assert.equal(allow('b'), true);
    assert.equal(allow('c'), false);
  });
});
