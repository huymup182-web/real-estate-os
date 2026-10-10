import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeLlmCall {
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

export interface FakeLlm {
  /** Gốc URL để đặt vào AI_BASE_URL. */
  url: string;
  calls: FakeLlmCall[];
  /** Phản hồi cho các lượt gọi tiếp theo. */
  reply: { status: number; body: unknown };
  close(): Promise<void>;
}

/** Máy chủ Anthropic Messages API giả cho test AI (TASK-133+). */
export async function startFakeLlm(): Promise<FakeLlm> {
  const fake: Omit<FakeLlm, 'url' | 'close'> = { calls: [], reply: { status: 200, body: {} } };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      fake.calls.push({ headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> });
      res.writeHead(fake.reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fake.reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

/** Đặt biến môi trường cho test; trả hàm trả lại giá trị cũ. */
export function setEnv(values: Record<string, string>): () => void {
  const saved = Object.entries(values).map(([name]) => [name, process.env[name]] as const);
  Object.assign(process.env, values);
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  };
}
