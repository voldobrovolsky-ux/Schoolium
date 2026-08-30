import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StructureModule } from '../structure/structure.module';
import { PilotService } from './pilot.service';
import { PilotController } from './pilot.controller';

// ВРЕМЕННЫЙ пилотный auth (AUTH_MODE=pilot-qr). Переиспользует StructureService (дисциплины/классы/
// назначение), не дублирует. Сессии — та же форма, что Флёр OIDC. Убрать при подключении настоящего Флёра.
@Module({
  imports: [PrismaModule, StructureModule],
  controllers: [PilotController],
  providers: [PilotService],
  exports: [PilotService],
})
export class PilotModule {}
