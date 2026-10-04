import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { AppConfig, StorageConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';

/** Link upload thẳng lên storage (phase0/02-ARCHITECTURE.md mục 4): client PUT file kèm `headers`. */
export interface UploadUrl {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/** Thông tin object đã có trên storage. */
export interface StoredObject {
  sizeBytes: number;
  contentType: string | null;
}

/** Thời hạn link upload và link đọc ảnh (giây). */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const READ_URL_TTL_SECONDS = 60 * 60;

/**
 * Bọc object storage S3 / Cloudflare R2 / MinIO (cấu hình STORAGE_* trong docs/environment.md).
 * Backend không nhận file: chỉ cấp link upload có hạn, kiểm object sau khi upload và cấp link đọc.
 */
@Injectable()
export class StorageService {
  private readonly config: StorageConfig | null;
  private readonly client: S3Client | null;

  constructor(@Inject(APP_CONFIG) appConfig: AppConfig) {
    this.config = appConfig.storage;
    this.client = this.config
      ? new S3Client({
          region: this.config.region,
          ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
          forcePathStyle: this.config.forcePathStyle,
          credentials: {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          },
        })
      : null;
  }

  /** Link PUT có hạn cho đúng `key` và `contentType`. */
  async createUploadUrl(key: string, contentType: string): Promise<UploadUrl> {
    const { client, bucket } = this.require();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      // Ký kèm content-type: storage từ chối file upload khác định dạng đã khai báo.
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type']) },
    );
    return {
      url,
      headers: { 'content-type': contentType },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  /** Thông tin object, hoặc null nếu chưa có. */
  async head(key: string): Promise<StoredObject | null> {
    const { client, bucket } = this.require();
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  /** Tải toàn bộ object về bộ nhớ (dùng cho file nhỏ như ảnh ≤ 10MB). */
  async getObject(key: string): Promise<Buffer> {
    const { client, bucket } = this.require();
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) {
      throw new Error(`Object rỗng: ${key}`);
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  /** Ghi object do backend tạo (vd thumbnail). */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Địa chỉ đọc ảnh: qua CDN nếu có STORAGE_PUBLIC_URL, không thì link GET có hạn. */
  async readUrl(key: string): Promise<string> {
    const { client, bucket } = this.require();
    if (this.config?.publicUrl) {
      return `${this.config.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
    }
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: READ_URL_TTL_SECONDS,
    });
  }

  private require(): { client: S3Client; bucket: string } {
    if (!this.client || !this.config) {
      throw new AppException(
        ErrorCode.INTERNAL_ERROR,
        'Chưa cấu hình lưu trữ ảnh (STORAGE_BUCKET), liên hệ quản trị hệ thống',
      );
    }
    return { client: this.client, bucket: this.config.bucket };
  }
}
