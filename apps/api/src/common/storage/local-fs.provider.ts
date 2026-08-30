import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { HeadResult, PresignedUrl, StorageProvider } from './storage.types';

const TOKEN_TTL_MS = 15 * 60 * 1000; // как presign S3 (15 мин)

interface TokenEntry {
  key: string;
  mime?: string;
  mode: 'put' | 'get';
  expiresAt: number;
}

/**
 * Локальный дисковый провайдер хранилища (STORAGE_MODE=local): dev/CI/пилот без S3.
 * Семантика ТА ЖЕ, что у S3: «pre-signed» URL = одноразовый токен на PUT/GET через
 * LocalStorageController (браузер льёт файл напрямую, как в S3-контуре). Токены в памяти
 * процесса (жизни presign в 15 мин достаточно; рестарт = потеря токенов, НЕ файлов).
 * НЕ для продакшена — там S3CompatibleProvider (Yandex/AWS/MinIO).
 */
@Injectable()
export class LocalFsProvider implements StorageProvider {
  private readonly log = new Logger('LocalFsStorage');
  private readonly dir = process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), '.data', 'storage');
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly mimeByKey = new Map<string, string>();

  private issue(key: string, mode: 'put' | 'get', mime?: string): string {
    // подчистить протухшие (лениво, чтобы map не рос бесконечно)
    const now = Date.now();
    for (const [t, e] of this.tokens) if (e.expiresAt < now) this.tokens.delete(t);
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, { key, mime, mode, expiresAt: now + TOKEN_TTL_MS });
    return token;
  }

  /** Резолв токена (используется LocalStorageController). null — нет/протух/не тот метод. */
  resolveToken(token: string, mode: 'put' | 'get'): TokenEntry | null {
    const e = this.tokens.get(token);
    if (!e || e.mode !== mode || e.expiresAt < Date.now()) return null;
    return e;
  }

  private abs(key: string): string {
    // ключи вида docs/<ws>/<hex>.<ext> — нормализуем и не выпускаем за пределы dir
    const p = path.normalize(path.join(this.dir, key));
    if (!p.startsWith(path.normalize(this.dir))) throw new Error(`недопустимый ключ ${key}`);
    return p;
  }

  async writeObject(key: string, body: Buffer, mime?: string): Promise<void> {
    const p = this.abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    if (mime) this.mimeByKey.set(key, mime);
    this.log.debug(`PUT ${key} (${body.length} байт)`);
  }

  async getUploadUrl(key: string, mime: string): Promise<PresignedUrl> {
    const token = this.issue(key, 'put', mime);
    // относительный URL: браузер шлёт на тот же origin (Vite proxy → API), как presigned PUT
    return { url: `/api/v1/storage/local/${token}`, expiresIn: TOKEN_TTL_MS / 1000 };
  }

  async getDownloadUrl(key: string): Promise<PresignedUrl> {
    const token = this.issue(key, 'get');
    return { url: `/api/v1/storage/local/${token}`, expiresIn: TOKEN_TTL_MS / 1000 };
  }

  async headObject(key: string): Promise<HeadResult> {
    try {
      const st = await fs.stat(this.abs(key));
      return { exists: true, size: st.size, contentType: this.mimeByKey.get(key) };
    } catch {
      return { exists: false };
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.abs(key));
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await fs.rm(this.abs(key), { force: true });
    this.mimeByKey.delete(key);
  }
}
