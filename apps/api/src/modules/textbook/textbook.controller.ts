import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { OutboxDispatcher } from '../../common/outbox/outbox.dispatcher';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { MaterialService } from './material.service';
import { ParserService } from './parser.service';

interface UploadInitBody {
  mime: string;
  assignmentId?: string; // селектор СВОИХ назначений (несколько флажков); одно — авто без поля
}

// Учебники — /api/v1/edu/materials/*. Загрузка ТОЛЬКО upload-init → commit (docs/-контур, S3-абстракция).
@Controller('v1/edu/materials')
export class TextbookController {
  constructor(
    private readonly material: MaterialService,
    private readonly parser: ParserService,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  /**
   * Инициировать загрузку учебника → pre-signed PUT (docs/). Гейт: право учителя (§5.1).
   * Класс+дисциплина НЕ передаются руками — резолвятся из TeachingAssignment учителя.
   */
  @RequirePermission('materials.textbook.upload')
  @Post('upload-init')
  uploadInit(@Body() body: UploadInitBody, @Req() req: Request & { user?: SessionUser }) {
    return this.material.uploadInit(body, this.actor(req));
  }

  /** Подтвердить загрузку → Material + textbook.uploaded; прогнать каскад (enrich → parsed → КТП). */
  @RequirePermission('materials.textbook.upload')
  @Post(':fileId/commit')
  async commit(@Param('fileId') fileId: string, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.material.commit(fileId, this.actor(req));
    await this.dispatcher.drain(); // doc.file.created → enrich → doc.file.enriched → parser → textbook.parsed → ktp.generated
    return res;
  }

  /** Разбор учебника (темы/карты) по fileId — для UI/проверки. */
  @Get(':fileId/parsed')
  parsed(@Param('fileId') fileId: string) {
    return this.parser.getParsed(fileId);
  }
}
