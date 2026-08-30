import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

// Чтение audit-леджера (§4.8). Тенант-scoped tenant-guard'ом — видно только свою орг.
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.audit.list(limit ? Math.min(Number(limit) || 100, 500) : 100);
  }
}
