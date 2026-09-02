import { Controller, Get } from '@nestjs/common';
import type { DeputyCabinetDto } from '@edustore/shared';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { DeputyCabinetService } from './deputy-cabinet.service';

/**
 * Кабинет завуча `S-61` (AR-186, AR-193): чтение без единой мутации — надзор,
 * а не управление. Право `school.oversee` держат завуч и администратор;
 * модератор кабинета не видит (G-81), его рабочий экран — `S-60`.
 */
@Controller('v1/deputy')
export class DeputyCabinetController {
  constructor(private readonly svc: DeputyCabinetService) {}

  @RequirePermission('school.oversee')
  @Get()
  cabinet(): Promise<DeputyCabinetDto> {
    return this.svc.cabinet();
  }
}
