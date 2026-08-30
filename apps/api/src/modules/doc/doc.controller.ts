import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { DocService } from './doc.service';

interface UploadUrlBody { mime: string; scope?: string; disciplineId?: string; classId?: string }
interface TagsBody { add?: { dim: string; value: string }[]; remove?: string[] }
interface AccessBody { scope?: string; audience?: string }
interface StatusBody { to: string }
interface ShareBody { granteeId?: string; linkToken?: string; level: string; expiresAt?: string }
interface LensBody { name: string; filter: Prisma.InputJsonValue; shared?: boolean }
interface CollectionBody { name: string }

// Документохранилище — /api/v1/doc/*. Загрузка ТОЛЬКО upload-url → commit (прямого multipart нет).
@Controller('v1/doc')
export class DocController {
  constructor(private readonly doc: DocService) {}

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  // ─── Файлы: загрузка/чтение ───
  @RequirePermission('doc.files.manage')
  @Post('files/upload-url')
  uploadUrl(@Body() body: UploadUrlBody, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.uploadUrl(body, this.actor(req));
  }
  @RequirePermission('doc.files.manage')
  @Post('files/:id/commit')
  commit(@Param('id') id: string) {
    return this.doc.commit(id);
  }
  @Get('files/:id')
  getFile(@Param('id') id: string) {
    return this.doc.getFile(id);
  }
  @Get('files/:id/url')
  getUrl(@Param('id') id: string) {
    return this.doc.getUrl(id);
  }
  @Get('files')
  list(
    @Query('scope') scope?: string,
    @Query('audience') audience?: string,
    @Query('disciplineId') disciplineId?: string,
    @Query('classId') classId?: string,
    @Query('q') q?: string,
  ) {
    return this.doc.list({ scope, audience, disciplineId, classId, q });
  }
  @RequirePermission('doc.files.manage')
  @Delete('files/:id')
  deleteFile(@Param('id') id: string, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.deleteFile(id, this.actor(req));
  }

  // ─── Теги / доступ ───
  @RequirePermission('doc.files.manage')
  @Patch('files/:id/tags')
  updateTags(@Param('id') id: string, @Body() body: TagsBody) {
    return this.doc.updateTags(id, body.add, body.remove);
  }
  @RequirePermission('doc.files.publish')
  @Post('files/:id/access')
  setAccess(@Param('id') id: string, @Body() body: AccessBody, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.setAccess(id, body, this.actor(req));
  }

  // ─── Версии / статус ───
  @Get('files/:id/versions')
  versions(@Param('id') id: string) {
    return this.doc.listVersions(id);
  }
  @RequirePermission('doc.files.manage')
  @Post('files/:id/versions')
  snapshot(@Param('id') id: string, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.snapshotVersion(id, this.actor(req));
  }
  @RequirePermission('doc.files.manage')
  @Post('files/:id/versions/:no/restore')
  restore(@Param('id') id: string, @Param('no') no: string, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.restoreVersion(id, Number(no), this.actor(req));
  }
  @RequirePermission('doc.files.publish')
  @Post('files/:id/status')
  setStatus(@Param('id') id: string, @Body() body: StatusBody, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.setStatus(id, body.to, this.actor(req));
  }

  // ─── Шары / линзы / коллекции ───
  @RequirePermission('doc.files.publish')
  @Post('files/:id/share')
  share(@Param('id') id: string, @Body() body: ShareBody, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.share(id, body, this.actor(req));
  }
  @RequirePermission('doc.files.publish')
  @Delete('shares/:id')
  revokeShare(@Param('id') id: string) {
    return this.doc.revokeShare(id);
  }
  @Get('lenses')
  lenses() {
    return this.doc.listLenses();
  }
  @RequirePermission('doc.files.manage')
  @Post('lenses')
  createLens(@Body() body: LensBody, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.createLens(body, this.actor(req));
  }
  @Get('collections')
  collections() {
    return this.doc.listCollections();
  }
  @RequirePermission('doc.files.manage')
  @Post('collections')
  createCollection(@Body() body: CollectionBody, @Req() req: Request & { user?: SessionUser }) {
    return this.doc.createCollection(body.name, this.actor(req));
  }
}
