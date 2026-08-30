import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CabinetsService } from './cabinets.service';
import { CabinetsController } from './cabinets.controller';

// Кабинеты (Кабинеты_ТЗ §2-4): методкопилка/курсы/курирование + надзор завуча scope=school.
@Module({
  imports: [PrismaModule],
  controllers: [CabinetsController],
  providers: [CabinetsService],
})
export class CabinetsModule {}
