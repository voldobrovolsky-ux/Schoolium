import { Controller, Get, Inject, NotFoundException, Param, PayloadTooLargeException, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { LocalFsProvider } from './local-fs.provider';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // учебники-PDF; выше — 413

/**
 * Транспорт локального хранилища (только STORAGE_MODE=local): принимает «presigned» PUT/GET
 * по одноразовому токену — браузер работает с ним ровно как с S3 pre-signed URL.
 * @Public по той же модели, что presign S3: право доступа = знание короткоживущего токена.
 * При S3-режиме LocalFsProvider не инстанцируется и роуты отдают 404.
 */
@Controller('v1/storage/local')
export class LocalStorageController {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  private local(): LocalFsProvider | null {
    return this.storage instanceof LocalFsProvider ? this.storage : null;
  }

  @Public()
  @Put(':token')
  async put(@Param('token') token: string, @Req() req: Request): Promise<{ ok: true }> {
    const local = this.local();
    const entry = local?.resolveToken(token, 'put');
    if (!local || !entry) throw new NotFoundException('токен загрузки не найден или истёк');
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_UPLOAD_BYTES) {
          reject(new PayloadTooLargeException('файл слишком большой'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve());
      req.on('error', (e) => reject(e));
    });
    await local.writeObject(entry.key, Buffer.concat(chunks), entry.mime ?? req.headers['content-type']);
    return { ok: true };
  }

  @Public()
  @Get(':token')
  async get(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const local = this.local();
    const entry = local?.resolveToken(token, 'get');
    if (!local || !entry) throw new NotFoundException('токен скачивания не найден или истёк');
    const body = await local.getObject(entry.key);
    if (!body) throw new NotFoundException('объект не найден');
    const head = await local.headObject(entry.key);
    res.setHeader('content-type', head.contentType ?? 'application/octet-stream');
    res.send(body);
  }
}
