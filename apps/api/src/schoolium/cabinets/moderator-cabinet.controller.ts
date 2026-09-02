import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminCabinetDto } from '@edustore/shared';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import type { SessionUser } from '../../common/auth/flor.service';
import { AuditService } from '../../common/audit/audit.service';
import { actorOf } from '../actor';
import { SchoolStateService } from '../school-state.service';
import { AdminCabinetService } from './admin-cabinet.service';

type Req0 = Request & { user?: SessionUser };

/**
 * Кабинет модератора `S-60` — прежний `/api/v1/admin` (AR-186): путь ушёл
 * кабинету администратора, содержание не изменилось. Роли, кроме модератора,
 * получают 403 — не пустую страницу и не молчаливый редирект.
 *
 * Аудит здесь — не украшение, а противовес полным правам (AR-88): модератор
 * видит собственный след теми же словами, какими его увидит проверяющий.
 * Слова строк — из `AdminCabinetService.auditEntries`: одна проекция леджера
 * на оба кабинета, чтобы «изменён реестр сети» звучало одинаково в `S-60` и `S-62`.
 */
@Controller('v1/moderator')
export class ModeratorCabinetController {
  constructor(
    private readonly state: SchoolStateService,
    private readonly audit: AuditService,
    private readonly admin: AdminCabinetService,
  ) {}

  @RequirePermission('school.manage')
  @Get()
  async cabinet(@Req() req: Req0): Promise<AdminCabinetDto> {
    const actor = actorOf(req);
    const [state, rows] = await Promise.all([this.state.resolve(), this.audit.listByActor(actor.userId, 100)]);
    const audit = await this.admin.auditEntries(rows);
    return { state, audit: audit.map(({ actorId: _a, actorName: _n, ...entry }) => entry) };
  }
}
