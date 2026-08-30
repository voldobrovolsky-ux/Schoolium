import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';

const ORPHAN_TTL_MS = 15 * 60 * 1000; // upload-url выдан, commit не пришёл в TTL → сирота

/**
 * Orphan-GC (Документохранилище_ТЗ §4): чистит File со state=pending (upload-url выдан, PUT/commit
 * не случились в TTL). Системный контекст (вне HTTP) → guard пропускает, чистим по всем школам.
 */
@Injectable()
export class DocGcWorker {
  private readonly log = new Logger('DocGC');

  constructor(private readonly prisma: PrismaService) {}

  @Interval('doc-orphan-gc', 5 * 60 * 1000)
  async tick() {
    const cutoff = new Date(Date.now() - ORPHAN_TTL_MS);
    await TenantContext.runAsSystem(async () => {
      const r = await this.prisma.file.deleteMany({ where: { state: 'pending', createdAt: { lt: cutoff } } });
      if (r.count) this.log.warn(`orphan-GC: удалено ${r.count} незакоммиченных file (PUT/commit не пришли в TTL)`);
    });
  }
}
