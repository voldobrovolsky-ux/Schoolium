import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthzService } from './authz.service';

/**
 * Authz-слой (§5.1): права как данные. Глобальный — резолвер доступа доступен везде
 * (контроллеры, гейты модулей §5.2). Каталог засевается на старте (AuthzService.onModuleInit).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuthzService],
  exports: [AuthzService],
})
export class AuthzModule {}
