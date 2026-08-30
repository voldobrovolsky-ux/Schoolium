import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StructureService } from './structure.service';
import { StructureController } from './structure.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StructureController],
  providers: [StructureService],
  exports: [StructureService], // переиспользуется пилотным auth (owner-экран: дисциплины/классы/назначение)
})
export class StructureModule {}
