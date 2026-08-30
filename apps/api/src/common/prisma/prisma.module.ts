import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Глобальный модуль доступа к БД: PrismaService доступен всем доменным модулям
 * без повторного импорта (границы доменов сохраняются — общий лишь клиент БД).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
