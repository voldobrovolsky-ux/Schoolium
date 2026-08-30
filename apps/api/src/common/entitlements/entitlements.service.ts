import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EntitlementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { syncSkus } from './skus';

/**
 * Entitlements (§5.2): гейт загрузки модуля = активный entitlement тенанта.
 * Слои доступа: entitlement (модуль на тенант) → пакет роли × каталог (§5.1) → ABAC [слот].
 * Запросы Entitlement тенант-scoped через guard (вызовы — в контексте запроса).
 */
@Injectable()
export class EntitlementsService implements OnModuleInit {
  private readonly log = new Logger('Entitlements');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await syncSkus(this.prisma); // каталог SKU есть в любой среде
    this.log.log('каталог SKU синхронизирован');
  }

  /** Есть ли у текущего тенанта активный (или trial) entitlement на SKU. */
  async isActive(skuKey: string): Promise<boolean> {
    const now = new Date();
    const ent = await this.prisma.entitlement.findFirst({
      where: {
        sku: { key: skuKey },
        status: { in: [EntitlementStatus.active, EntitlementStatus.trial] },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
    });
    return !!ent;
  }

  /** Активные entitlement'ы тенанта (для /me и админ-UI). */
  list() {
    return this.prisma.entitlement.findMany({ include: { sku: true }, orderBy: { createdAt: 'desc' } });
  }
}
