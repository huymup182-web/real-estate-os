import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hash } from '@node-rs/argon2';

import { ARGON2_OPTIONS, hashPassword, needsRehash, verifyPassword } from '../src/auth/password.js';

describe('Băm mật khẩu', () => {
  it('dùng Argon2id với tham số cố định, mỗi lần băm có salt khác nhau', async () => {
    const first = await hashPassword('mat-khau-1');
    const second = await hashPassword('mat-khau-1');
    assert.match(first, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.notEqual(first, second);
    assert.equal(await verifyPassword(first, 'mat-khau-1'), true);
    assert.equal(await verifyPassword(first, 'mat-khau-2'), false);
  });

  it('mật khẩu tiếng Việt gõ dạng dựng sẵn hay tổ hợp đều đăng nhập được', async () => {
    const composed = 'Mật khẩu Đà Nẵng'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    assert.notEqual(composed, decomposed);
    const passwordHash = await hashPassword(composed);
    assert.equal(await verifyPassword(passwordHash, decomposed), true);
  });

  it('chuỗi băm hỏng coi như sai mật khẩu', async () => {
    assert.equal(await verifyPassword('khong-phai-chuoi-bam', 'x'), false);
    assert.equal(await verifyPassword('', 'x'), false);
  });
});

describe('needsRehash', () => {
  it('không cần băm lại khi dùng đúng tham số hiện tại (kể cả mật khẩu do seed băm)', async () => {
    assert.equal(needsRehash(await hashPassword('a-b-c-d-e')), false);
    // database/src/seed.ts băm bằng tham số mặc định của thư viện.
    assert.equal(needsRehash(await hash('a-b-c-d-e', { algorithm: 2 })), false);
  });

  it('cần băm lại khi tham số yếu hơn, khác thuật toán, hoặc chuỗi băm hỏng', async () => {
    assert.equal(needsRehash(await hash('x', { ...ARGON2_OPTIONS, timeCost: 1 })), true);
    assert.equal(needsRehash(await hash('x', { ...ARGON2_OPTIONS, memoryCost: 8192 })), true);
    assert.equal(needsRehash(await hash('x', { ...ARGON2_OPTIONS, algorithm: 0 })), true);
    assert.equal(needsRehash('khong-phai-chuoi-bam'), true);
  });
});
