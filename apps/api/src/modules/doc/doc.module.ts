import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { DocService } from './doc.service';
import { DocController } from './doc.controller';
import { DocEnrichHandlers } from './doc.enrich.handlers';
import { DocGcWorker } from './doc.gc.worker';

// Документохранилище (Документохранилище_ТЗ): файлы поверх StorageProvider (глобальный StorageModule),
// обогащение raw→enriched, orphan-GC. Outbox/EventBus — из EventsModule.
@Module({
  imports: [PrismaModule],
  controllers: [DocController],
  providers: [DocService, DocEnrichHandlers, DocGcWorker],
  exports: [DocService],
})
export class DocModule {}
