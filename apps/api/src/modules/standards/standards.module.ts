import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StandardsService } from './standards.service';
import { StandardsController } from './standards.controller';

// Контракты завуча/методиста (Техспека §3): AssessmentPolicy/OrgStandards/FgosHours (завуч) +
// TimingProfile (методист). Производитель; движок/журнал читают. Outbox — из EventsModule.
@Module({
  imports: [PrismaModule],
  controllers: [StandardsController],
  providers: [StandardsService],
})
export class StandardsModule {}
