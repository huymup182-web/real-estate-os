import { createSign } from 'node:crypto';

import type { FcmConfig } from '../config/app-config.js';

/** Quyền OAuth2 cần để gửi tin qua FCM HTTP v1. */
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_SEND_BASE = 'https://fcm.googleapis.com';
/** Thời hạn JWT assertion (tối đa Google cho phép là 1 giờ). */
const ASSERTION_TTL_SECONDS = 3600;
/** Đổi access token mới sớm hơn hạn thật để không gửi bằng token vừa hết hạn. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Khoá dữ liệu FCM cấm dùng (tài liệu FCM: message.data). */
const RESERVED_DATA_KEYS = new Set(['from', 'notification', 'message_type']);
const RESERVED_DATA_PREFIXES = ['google', 'gcm'];

/** Nội dung một tin đẩy; `data` phải là chuỗi theo yêu cầu FCM. */
export interface FcmMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

/** `invalid-token`: thiết bị đã gỡ app hoặc token sai, nên xoá token khỏi hệ thống. */
export type FcmSendResult = 'sent' | 'invalid-token';

export interface FcmClientOptions {
  fetch?: typeof fetch;
  /** Gốc URL gửi tin; đổi được để test với máy chủ giả. */
  sendBaseUrl?: string;
  now?: () => number;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * Gọi FCM HTTP v1 trực tiếp (TASK-093), không cần SDK firebase-admin: ký JWT RS256 bằng khoá service
 * account, đổi lấy access token OAuth2 (cache tới gần hết hạn) rồi gửi từng tin tới một token thiết bị.
 */
export class FcmClient {
  private readonly fetch: typeof fetch;
  private readonly sendUrl: string;
  private readonly now: () => number;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: FcmConfig,
    options: FcmClientOptions = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    const base = (options.sendBaseUrl ?? FCM_SEND_BASE).replace(/\/+$/, '');
    this.sendUrl = `${base}/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`;
    this.now = options.now ?? Date.now;
  }

  /** Lỗi khác token hỏng (mạng, 5xx, quota, sai cấu hình) thì ném ra. */
  async send(token: string, message: FcmMessage): Promise<FcmSendResult> {
    const response = await this.fetch(this.sendUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.getAccessToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      return 'sent';
    }

    const error = await readError(response);
    if (response.status === 404 || error.code === 'UNREGISTERED') {
      return 'invalid-token';
    }
    if (response.status === 400 && error.code === 'INVALID_ARGUMENT') {
      return 'invalid-token';
    }
    if (response.status === 401) {
      // Token bị thu hồi trước hạn: lần gửi sau lấy token mới.
      this.accessToken = null;
    }
    throw new Error(`FCM trả lỗi ${response.status}${error.code ? ` ${error.code}` : ''}`);
  }

  private async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.accessToken && now < this.accessToken.expiresAt) {
      return this.accessToken.value;
    }

    const response = await this.fetch(this.config.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: this.assertion(now),
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Không lấy được access token FCM: ${response.status}`);
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      throw new Error('Không lấy được access token FCM: phản hồi thiếu access_token');
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : ASSERTION_TTL_SECONDS;
    this.accessToken = {
      value: body.access_token,
      expiresAt: now + expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS,
    };
    return body.access_token;
  }

  private assertion(now: number): string {
    const iat = Math.floor(now / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: this.config.clientEmail,
        scope: FCM_SCOPE,
        aud: this.config.tokenUri,
        iat,
        exp: iat + ASSERTION_TTL_SECONDS,
      }),
    );
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(this.config.privateKey);
    return `${header}.${claims}.${base64Url(signature)}`;
  }
}

/** Mã lỗi FCM nằm ở `error.details[].errorCode`, dự phòng `error.status`. */
async function readError(response: Response): Promise<{ code: string | null }> {
  try {
    const body = (await response.json()) as {
      error?: { status?: unknown; details?: { errorCode?: unknown }[] };
    };
    const detail = body.error?.details?.find((d) => typeof d.errorCode === 'string');
    const code = detail?.errorCode ?? body.error?.status;
    return { code: typeof code === 'string' ? code : null };
  } catch {
    return { code: null };
  }
}

/** FCM chỉ nhận dữ liệu dạng chuỗi và cấm vài khoá: bỏ khoá cấm, đổi giá trị khác chuỗi sang JSON. */
export function toFcmData(data: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (
      value === undefined ||
      RESERVED_DATA_KEYS.has(lower) ||
      RESERVED_DATA_PREFIXES.some((prefix) => lower.startsWith(prefix))
    ) {
      continue;
    }
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return result;
}
