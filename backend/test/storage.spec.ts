import 'reflect-metadata';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AppConfig, StorageConfig } from '../src/config/app-config.js';
import { StorageService } from '../src/storage/storage.service.js';

const STORAGE: StorageConfig = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'anh-bds',
  accessKeyId: 'access',
  secretAccessKey: 'secret',
  forcePathStyle: true,
  publicUrl: null,
};

function serviceWith(storage: StorageConfig | null): StorageService {
  return new StorageService({
    port: 3000,
    nodeEnv: 'test',
    databaseUrl: 'postgresql://u:p@localhost:5432/x',
    logLevel: 'log',
    jwtSecret: 'khoa-test-du-dai-it-nhat-32-ky-tu-abc',
    mail: null,
    storage,
    fcm: null,
  } satisfies AppConfig);
}

describe('StorageService', () => {
  it('cấp link PUT có chữ ký, đúng bucket/key, có hạn 15 phút, ký kèm content-type', async () => {
    const before = Date.now();
    const upload = await serviceWith(STORAGE).createUploadUrl('t/properties/p/a.jpg', 'image/jpeg');
    const url = new URL(upload.url);
    assert.equal(url.origin, 'http://localhost:9000');
    assert.equal(url.pathname, '/anh-bds/t/properties/p/a.jpg');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
    assert.ok(url.searchParams.get('X-Amz-Signature'));
    assert.match(url.searchParams.get('X-Amz-SignedHeaders') ?? '', /content-type/);
    assert.deepEqual(upload.headers, { 'content-type': 'image/jpeg' });
    assert.ok(upload.expiresAt.getTime() >= before + 899_000);
  });

  it('link đọc: qua CDN nếu có STORAGE_PUBLIC_URL, không thì link GET có hạn 1 giờ', async () => {
    const cdn = serviceWith({ ...STORAGE, publicUrl: 'https://cdn.example.com' });
    assert.equal(
      await cdn.readUrl('t/properties/p/a b.jpg'),
      'https://cdn.example.com/t/properties/p/a%20b.jpg',
    );
    const signed = new URL(await serviceWith(STORAGE).readUrl('t/properties/p/a.jpg'));
    assert.equal(signed.pathname, '/anh-bds/t/properties/p/a.jpg');
    assert.equal(signed.searchParams.get('X-Amz-Expires'), '3600');
  });

  it('link ký cho giấy tờ: luôn qua storage dù có CDN, có hạn theo yêu cầu, tải về với tên file gốc', async () => {
    const cdn = serviceWith({ ...STORAGE, publicUrl: 'https://cdn.example.com' });
    const url = new URL(
      await cdn.signedReadUrl('t/properties/p/documents/d.pdf', 300, 'Sổ hồng.pdf'),
    );
    assert.equal(url.origin, 'http://localhost:9000');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(
      url.searchParams.get('response-content-disposition'),
      `attachment; filename*=UTF-8''${encodeURIComponent('Sổ hồng.pdf')}`,
    );
  });

  it('chưa cấu hình storage → lỗi rõ ràng', async () => {
    await assert.rejects(
      serviceWith(null).createUploadUrl('k', 'image/jpeg'),
      /Chưa cấu hình lưu trữ ảnh/,
    );
  });
});
