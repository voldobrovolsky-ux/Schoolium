import { Controller, Get } from '@nestjs/common';
import type { SchoolDirectoryEntryDto } from '@edustore/shared';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Витрина школ на лендинге (`S-92`, AR-163) — единственный публичный
 * cross-tenant листинг в системе. Отдаёт РОВНО четыре нечувствительных поля;
 * никогда не отдавать `select`-ом весь `Workspace` (там `orgId`/`worknetId`/
 * `florusWorkspaceId`/`sector` — не для анонима).
 */
@Controller('v1')
export class SchoolsDirectoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('schools')
  async schools(): Promise<SchoolDirectoryEntryDto[]> {
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.workspace.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          name: true,
          logoUrl: true,
          _count: { select: { memberships: { where: { deactivatedAt: null } } } },
        },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map((w) => ({ id: w.id, name: w.name, logoUrl: w.logoUrl, memberCount: w._count.memberships }));
  }
}
