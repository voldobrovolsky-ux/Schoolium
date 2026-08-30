import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';

// Согласие 152-ФЗ (§6). OutboxService/EventBus — из глобального EventsModule.
@Module({
  imports: [PrismaModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService], // гейт согласия доступен другим модулям (risk-score §6.3)
})
export class ConsentModule {}
