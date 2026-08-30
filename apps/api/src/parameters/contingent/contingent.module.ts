import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ContingentService } from './contingent.service';
import { ContingentController } from './contingent.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ContingentController],
  providers: [ContingentService],
})
export class ContingentModule {}
