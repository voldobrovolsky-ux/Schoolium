import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { GraphService } from './graph.service';

// Communitoria — /api/v1/comm/*. Чанк 1: read-only граф контактов (структурный, из RBAC+parenthood).
// Каналы/сообщения/звонки — следующие чанки.
@Controller('v1/comm')
export class CommController {
  constructor(private readonly graph: GraphService) {}

  /** Контакты текущего взрослого (структурно): его дети по рёбрам parenthood. */
  @Get('contacts')
  contacts(@Req() req: Request & { user?: SessionUser }) {
    return this.graph.contactsForAdult(req.user?.florusUserId ?? 'system');
  }

  /** Контакты минора (родители) — по studentId. Read-only. */
  @Get('contacts/minor')
  minorContacts(@Query('studentId') studentId: string) {
    return this.graph.contactsForMinor(studentId);
  }
}
