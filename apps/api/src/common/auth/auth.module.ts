import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FlorService } from './flor.service';
import { FlorController } from './flor.controller';
import { SchoolSessionService } from './school-session.service';

// Identity-слой (ADR-0005). Глобальный — FlorService доступен APP_GUARD'у.
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FlorController],
  providers: [FlorService, SchoolSessionService],
  exports: [FlorService, SchoolSessionService],
})
export class AuthModule {}
