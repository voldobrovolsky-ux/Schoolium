import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  STORAGE_CONFIG,
  type HeadResult,
  type PresignedUrl,
  type StorageConfig,
  type StorageProvider,
} from './storage.types';
import { isStorageConfigured } from './storage.config';

const PRESIGN_TTL = 900; // сек (15 мин)

/**
 * S3-совместимый провайдер (Yandex Object Storage / AWS / MinIO — один класс, различие в конфиге).
 * ЛЕНИВАЯ инициализация: S3Client создаётся при ПЕРВОЙ файловой операции, не на буте модуля.
 * Пустые ключи → сервис поднимается нормально; падает только сама операция с внятной 503.
 */
@Injectable()
export class S3CompatibleProvider implements StorageProvider {
  private client?: S3Client;

  constructor(@Inject(STORAGE_CONFIG) private readonly config: StorageConfig) {}

  private getClient(): S3Client {
    if (!isStorageConfigured(this.config)) {
      throw new ServiceUnavailableException(
        'Хранилище S3 не сконфигурировано: заполните S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (.env)',
      );
    }
    if (!this.client) {
      this.client = new S3Client({
        endpoint: this.config.endpoint,
        region: this.config.region,
        credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey },
        forcePathStyle: true, // совместимость Yandex/MinIO (path-style, не virtual-hosted)
      });
    }
    return this.client;
  }

  async getUploadUrl(key: string, mime: string): Promise<PresignedUrl> {
    const cmd = new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: mime });
    const url = await getSignedUrl(this.getClient(), cmd, { expiresIn: PRESIGN_TTL });
    return { url, expiresIn: PRESIGN_TTL };
  }

  async getDownloadUrl(key: string): Promise<PresignedUrl> {
    const cmd = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    const url = await getSignedUrl(this.getClient(), cmd, { expiresIn: PRESIGN_TTL });
    return { url, expiresIn: PRESIGN_TTL };
  }

  async headObject(key: string): Promise<HeadResult> {
    try {
      const r = await this.getClient().send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { exists: true, size: r.ContentLength, contentType: r.ContentType };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return { exists: false };
      throw e; // прочие ошибки (сеть/креды) — наружу
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const r = await this.getClient().send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!r.Body) return null;
      return Buffer.from(await r.Body.transformToByteArray());
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.getClient().send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
