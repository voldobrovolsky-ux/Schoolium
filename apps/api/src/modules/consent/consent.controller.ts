import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ConsentPurpose, ConsentSource } from '@prisma/client';
import type { SessionUser } from '../../common/auth/flor.service';
import { ConsentService } from './consent.service';
import { RequirePermission } from '../../common/authz/require-permission.decorator';

interface RecordBody {
  subjectUserId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  version?: string;
  grantedAt?: string; // ISO; для минора — дата бумажного
  evidenceRef?: string;
}

interface DeletionBody {
  subjectUserId: string;
  reason?: string;
}

// Согласие 152-ФЗ (§6): запись/просмотр/проверка + запрос на удаление.
@Controller('consent')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @RequirePermission('consent.record')
  @Post()
  record(@Body() body: RecordBody, @Req() req: Request & { user?: SessionUser }) {
    return this.consent.record({
      subjectUserId: body.subjectUserId,
      purpose: body.purpose,
      granted: body.granted,
      source: body.source,
      version: body.version,
      grantedAt: body.grantedAt ? new Date(body.grantedAt) : undefined,
      evidenceRef: body.evidenceRef,
    });
  }

  @Get(':subjectUserId')
  list(@Param('subjectUserId') subjectUserId: string) {
    return this.consent.list(subjectUserId);
  }

  @Get(':subjectUserId/check')
  async check(@Param('subjectUserId') subjectUserId: string, @Query('purpose') purpose: ConsentPurpose) {
    return { subjectUserId, purpose, granted: await this.consent.has(subjectUserId, purpose) };
  }

  @RequirePermission('consent.deletion.request')
  @Post('deletion-request')
  requestDeletion(@Body() body: DeletionBody, @Req() req: Request & { user?: SessionUser }) {
    return this.consent.requestDeletion(body.subjectUserId, req.user?.florusUserId ?? 'system', body.reason);
  }
}
