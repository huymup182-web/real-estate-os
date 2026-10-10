import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import nextConfig, { securityHeaders } from '../next.config.ts';

describe('TASK-155: header bảo mật của web quản trị', () => {
  it('chặn nhúng trang, đoán kiểu nội dung; HSTS chỉ ở production', () => {
    const dev = new Map(securityHeaders(false).map((header) => [header.key, header.value]));
    assert.equal(dev.get('X-Frame-Options'), 'DENY');
    assert.equal(dev.get('X-Content-Type-Options'), 'nosniff');
    assert.match(dev.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(dev.has('Strict-Transport-Security'), false);
    const production = new Map(securityHeaders(true).map((header) => [header.key, header.value]));
    assert.match(production.get('Strict-Transport-Security') ?? '', /max-age=31536000/);
  });

  it('áp cho mọi đường dẫn, không gửi X-Powered-By', async () => {
    assert.equal(nextConfig.poweredByHeader, false);
    const rules = await nextConfig.headers?.();
    assert.equal(rules?.[0]?.source, '/:path*');
  });
});
