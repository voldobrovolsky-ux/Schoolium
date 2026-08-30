import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

/** Модуль «журнал»: CRUD оценок, сводка класса. */
@Module({
  imports: [EngineModule], // писатель ячеек (AR-4)
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
