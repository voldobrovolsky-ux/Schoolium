import { Controller, Get } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';

// Активные entitlement'ы тенанта (§5.2). Тенант-scoped tenant-guard'ом.
@Controller('entitlements')
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  list() {
    return this.entitlements.list();
  }
}
