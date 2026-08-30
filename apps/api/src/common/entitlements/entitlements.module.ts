import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EntitlementsService } from './entitlements.service';
import { EntitlementsController } from './entitlements.controller';

/**
 * Entitlements (§5.2). Глобальный — EntitlementInterceptor (в app.module) и любые модули
 * с @RequireEntitlement используют EntitlementsService.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [EntitlementsController],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
