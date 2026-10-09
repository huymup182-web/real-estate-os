import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { AppConfig, FcmConfig } from '../src/config/app-config.js';
import { DeviceTokenStore } from '../src/notifications/device-token-store.js';
import { FcmPushSender, pushSenderFor } from '../src/notifications/fcm-push-sender.js';
import { FcmClient, toFcmData } from '../src/notifications/fcm.client.js';
import { NoopPushSender, type PushMessage } from '../src/notifications/push-sender.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

interface Recorded {
  path: string;
  authorization: string | undefined;
  body: string;
}

/** Máy chủ giả đóng cả OAuth2 (`/token`) lẫn FCM (`/v1/...`); token thiết bị quyết định phản hồi. */
let server: Server;
let baseUrl: string;
let requests: Recorded[] = [];
let tokenStatus = 200;

const FCM_RESPONSES: Record<string, { status: number; body: unknown }> = {
  'tok-gone': {
    status: 404,
    body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
  },
  'tok-bad': {
    status: 400,
    body: { error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } },
  },
  'tok-down': { status: 503, body: { error: { status: 'UNAVAILABLE' } } },
  'tok-revoked': { status: 401, body: { error: { status: 'UNAUTHENTICATED' } } },
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => resolve(data));
  });
}

function fcmConfig(): FcmConfig {
  return {
    projectId: 'bds-app',
    clientEmail: 'push@bds-app.iam',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    tokenUri: `${baseUrl}/token`,
  };
}

function client(now?: () => number): FcmClient {
  return new FcmClient(fcmConfig(), { sendBaseUrl: baseUrl, now });
}

const tokenRequests = (): Recorded[] => requests.filter((r) => r.path === '/token');
const sendRequests = (): Recorded[] => requests.filter((r) => r.path !== '/token');

const message = { title: 'BĐS mới', body: 'Có căn phù hợp', data: { propertyId: 'p1' } };

before(async () => {
  server = createServer((req, res) => {
    void readBody(req).then((body) => {
      requests.push({ path: req.url ?? '', authorization: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token') {
        res.statusCode = tokenStatus;
        res.end(JSON.stringify({ access_token: `access-${requests.length}`, expires_in: 3600 }));
        return;
      }
      const token = (JSON.parse(body) as { message: { token: string } }).message.token;
      const reply = FCM_RESPONSES[token] ?? {
        status: 200,
        body: { name: 'projects/x/messages/1' },
      };
      res.statusCode = reply.status;
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  requests = [];
  tokenStatus = 200;
});

describe('FcmClient', () => {
  it('ký JWT RS256 đổi access token, gửi tin FCM v1 và cache token tới gần hết hạn', async () => {
    let now = Date.UTC(2026, 9, 9);
    const fcm = client(() => now);

    assert.equal(await fcm.send('tok-1', { ...message, data: { a: '1' } }), 'sent');
    assert.equal(await fcm.send('tok-2', { ...message, data: {} }), 'sent');
    assert.equal(tokenRequests().length, 1);

    const form = new URLSearchParams(tokenRequests()[0]?.body);
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = (form.get('assertion') ?? '').split('.');
    assert.ok(header && claims && signature);
    assert.ok(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    );
    assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), {
      iss: 'push@bds-app.iam',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: `${baseUrl}/token`,
      iat: now / 1000,
      exp: now / 1000 + 3600,
    });

    const [first] = sendRequests();
    assert.equal(first?.path, '/v1/projects/bds-app/messages:send');
    assert.equal(first.authorization, 'Bearer access-1');
    assert.deepEqual(JSON.parse(first.body), {
      message: {
        token: 'tok-1',
        notification: { title: 'BĐS mới', body: 'Có căn phù hợp' },
        data: { a: '1' },
      },
    });

    now += 3600 * 1000;
    await fcm.send('tok-3', { ...message, data: {} });
    assert.equal(tokenRequests().length, 2);
  });

  it('token hỏng trả invalid-token; lỗi khác ném ra, 401 thì lấy access token mới', async () => {
    const fcm = client();
    const empty = { ...message, data: {} };
    assert.equal(await fcm.send('tok-gone', empty), 'invalid-token');
    assert.equal(await fcm.send('tok-bad', empty), 'invalid-token');
    await assert.rejects(fcm.send('tok-down', empty), /FCM trả lỗi 503 UNAVAILABLE/);
    assert.equal(tokenRequests().length, 1);

    await assert.rejects(fcm.send('tok-revoked', empty), /FCM trả lỗi 401/);
    await fcm.send('tok-1', empty);
    assert.equal(tokenRequests().length, 2);
  });

  it('không lấy được access token thì ném lỗi', async () => {
    tokenStatus = 400;
    await assert.rejects(
      client().send('tok-1', { ...message, data: {} }),
      /Không lấy được access token FCM: 400/,
    );
    assert.equal(sendRequests().length, 0);
  });

  it('toFcmData đổi giá trị sang chuỗi và bỏ khoá FCM cấm', () => {
    assert.deepEqual(
      toFcmData({
        propertyId: 'p1',
        score: 92,
        ids: ['a'],
        none: null,
        skip: undefined,
        from: 'x',
        google_x: 'y',
        GCM: 'z',
      }),
      { propertyId: 'p1', score: '92', ids: '["a"]', none: 'null' },
    );
  });
});

class MemoryTokens extends DeviceTokenStore {
  removed: string[] = [];

  constructor(private readonly tokens: Record<string, string[]>) {
    super();
  }

  tokensOf(userId: string): Promise<string[]> {
    return Promise.resolve(this.tokens[userId] ?? []);
  }

  remove(tokens: string[]): Promise<void> {
    this.removed.push(...tokens);
    return Promise.resolve();
  }
}

function push(userId: string): PushMessage {
  return {
    notificationId: 'n1',
    userId,
    type: 'NEW_PROPERTY',
    title: 'BĐS mới',
    body: 'Có căn phù hợp',
    data: { propertyId: 'p1', type: 'ghi-de', score: 92 },
  };
}

describe('FcmPushSender', () => {
  it('chưa có thiết bị thì trả false, không gọi FCM', async () => {
    const sender = new FcmPushSender(client(), new MemoryTokens({}));
    assert.equal(await sender.send(push('u1')), false);
    assert.equal(requests.length, 0);
  });

  it('gửi mọi thiết bị, xoá token hỏng, trả true khi có ít nhất một máy nhận', async () => {
    const tokens = new MemoryTokens({ u1: ['tok-1', 'tok-gone', 'tok-down', 'tok-bad'] });
    const sender = new FcmPushSender(client(), tokens);

    assert.equal(await sender.send(push('u1')), true);
    assert.deepEqual(tokens.removed.sort(), ['tok-bad', 'tok-gone']);
    const sent = sendRequests().map(
      (r) => JSON.parse(r.body) as { message: { token: string; data: unknown } },
    );
    assert.equal(sent.length, 4);
    assert.deepEqual(sent.find((m) => m.message.token === 'tok-1')?.message.data, {
      propertyId: 'p1',
      type: 'NEW_PROPERTY',
      score: '92',
      notificationId: 'n1',
    });
  });

  it('mọi thiết bị hỏng thì trả false; mọi lần gửi lỗi thì ném lỗi', async () => {
    const tokens = new MemoryTokens({ gone: ['tok-gone'], down: ['tok-down'] });
    const sender = new FcmPushSender(client(), tokens);
    assert.equal(await sender.send(push('gone')), false);
    assert.deepEqual(tokens.removed, ['tok-gone']);
    await assert.rejects(sender.send(push('down')), /FCM trả lỗi 503/);
  });
});

describe('pushSenderFor', () => {
  it('có FCM_CONFIG thì dùng FCM, không thì chỉ lưu hộp thư', () => {
    const base = { fcm: null } as AppConfig;
    const tokens = new MemoryTokens({});
    assert.ok(pushSenderFor(base, tokens) instanceof NoopPushSender);
    assert.ok(pushSenderFor({ ...base, fcm: fcmConfig() }, tokens) instanceof FcmPushSender);
  });
});
