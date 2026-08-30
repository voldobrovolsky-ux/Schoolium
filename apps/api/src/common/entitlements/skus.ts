import { PrismaClient, SkuKind } from '@prisma/client';

/** Каталог SKU (§5.2) — глобальная reference-data. Засевается на старте (boot-sync) и в сиде. */
export const DEFAULT_SKUS: { key: string; kind: SkuKind; label: string }[] = [
  { key: 'lms.core', kind: SkuKind.module, label: 'Ядро LMS — кабинет учителя' },
  { key: 'param.nutrition', kind: SkuKind.module, label: 'Параметр: Питание' },
  { key: 'param.communitoria', kind: SkuKind.module, label: 'Параметр: Communitoria' },
];

export async function syncSkus(prisma: PrismaClient): Promise<void> {
  for (const s of DEFAULT_SKUS) {
    await prisma.sku.upsert({
      where: { key: s.key },
      update: { kind: s.kind, label: s.label },
      create: s,
    });
  }
}
