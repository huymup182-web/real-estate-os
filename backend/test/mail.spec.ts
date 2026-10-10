import 'reflect-metadata';

import assert from 'node:assert/strict';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { AppConfig, MailConfig } from '../src/config/app-config.js';
import { MailService } from '../src/mail/mail.service.js';

/** Máy chủ SMTP tối giản chỉ dùng cho test: nhận thư và lưu lại nội dung DATA. */
function startFakeSmtp(received: string[]): Promise<Server> {
  const server = createServer((socket) => {
    let inData = false;
    let data = '';
    let buffer = '';
    socket.write('220 fake-smtp\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(data);
            data = '';
            socket.write('250 OK\r\n');
          } else {
            data += `${line}\n`;
          }
        } else if (/^(EHLO|HELO)/i.test(line)) {
          socket.write('250 fake-smtp\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function configWith(mail: MailConfig | null): AppConfig {
  return {
    port: 3000,
    nodeEnv: 'test',
    databaseUrl: 'postgresql://u:p@localhost:5432/x',
    logLevel: 'log',
    jwtSecret: 'khoa-test-du-dai-it-nhat-32-ky-tu-abc',
    mail,
    storage: null,
    fcm: null,
    ai: null,
  };
}

describe('MailService', () => {
  const received: string[] = [];
  let server: Server;

  before(async () => {
    server = await startFakeSmtp(received);
  });

  after(() => {
    server.close();
  });

  it('gửi email qua SMTP với người gửi MAIL_FROM', async () => {
    const { port } = server.address() as AddressInfo;
    const mail = new MailService(
      configWith({
        host: '127.0.0.1',
        port,
        secure: false,
        user: null,
        password: null,
        from: 'no-reply@realestate-os.test',
      }),
    );
    await mail.send({ to: 'khach@test.vn', subject: 'Xin chào', text: 'Nội dung thử' });
    assert.equal(received.length, 1);
    const message = received[0] ?? '';
    assert.match(message, /^From: no-reply@realestate-os\.test$/m);
    assert.match(message, /^To: khach@test\.vn$/m);
  });

  it('chưa cấu hình SMTP thì bỏ qua, không lỗi', async () => {
    const mail = new MailService(configWith(null));
    await mail.send({ to: 'khach@test.vn', subject: 'Xin chào', text: 'x' });
  });
});
