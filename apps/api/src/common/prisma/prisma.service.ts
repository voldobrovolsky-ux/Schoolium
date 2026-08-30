import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyTenantGuard } from '../tenant/tenant-guard';

/**
 * Единая точка доступа к БД. Подключается при старте модуля,
 * корректно закрывает соединение при остановке приложения.
 * Tenant-guard (§3.6) навешивается в конструкторе — до любого запроса.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    applyTenantGuard(this); // изоляция тенанта на каждом запросе доменной модели
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
