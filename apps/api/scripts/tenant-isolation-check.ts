/**
 * §3.6 — проверка изоляции тенанта (готовность: «ни один запрос не пересекает границу»).
 * Поднимает реальный Nest-контекст (тот же PrismaService с tenant-guard) и через
 * TenantContext эмулирует два тенанта A/B, проверяя что guard не пускает чтения/записи
 * за границу. Запуск: npm run tenant:check  (нужен поднятый Postgres).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { TenantInterceptor } from '../src/common/tenant/tenant.interceptor';

const A = 'tenant-test-A';
const B = 'tenant-test-B';

async function reset(prisma: PrismaService) {
  await TenantContext.runAsSystem(async () => {
    for (const t of [A, B]) {
      await prisma.student.deleteMany({ where: { workspaceId: t } });
      await prisma.class.deleteMany({ where: { workspaceId: t } });
      await prisma.workspace.deleteMany({ where: { id: t } });
    }
  });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);

  await reset(prisma);
  // setup в системном контексте: два workspace (школы) под платформой, класс+ученик на каждую
  await TenantContext.runAsSystem(async () => {
    const platform = await prisma.organization.upsert({
      where: { id: 'org-edustore-platform' },
      update: {},
      create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' },
    });
    for (const t of [A, B]) {
      await prisma.workspace.create({ data: { id: t, orgId: platform.id, name: `Test ${t}` } });
      const c = await prisma.class.create({
        data: { workspaceId: t, parallel: 1, letter: 'A', label: '1A' },
      });
      await prisma.student.create({
        data: { workspaceId: t, classId: c.id, number: 1, firstName: 'S', lastName: t, displayName: `S-${t}` },
      });
    }
  });
  // ВАЖНО: Prisma-запрос ленив (PrismaPromise) — выполняется при await, а не при создании.
  // Поэтому await ВНУТРИ колбэка контекста, иначе запрос исполнится вне ALS (как и реальный
  // интерсептор подписывается на обработчик внутри TenantContext.run).
  const studentB = (await TenantContext.runAsSystem(async () =>
    prisma.student.findFirst({ where: { workspaceId: B } }),
  ))!;

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };

  // ── запросы в контексте тенанта A ──
  await TenantContext.run({ tenantId: A, system: false }, async () => {
    const seen = await prisma.student.findMany();
    check('findMany в A видит только A', seen.length === 1 && seen[0].workspaceId === A);

    const leak = await prisma.student.findUnique({ where: { id: studentB.id } });
    check('findUnique(чужой id B) → null', leak === null);

    let blocked = false;
    try {
      await prisma.student.update({ where: { id: studentB.id }, data: { firstName: 'HACK' } });
    } catch (e) {
      blocked = (e as { code?: string }).code === 'P2025';
    }
    check('update(чужой id B) → P2025 (запись заблокирована)', blocked);

    const cnt = await prisma.student.count();
    check('count в A не учитывает B', cnt === seen.length);
  });

  // ── fail-closed: аутентифицирован, но тенант не разрешён и не system ──
  // await ВНУТРИ колбэка — чтобы запрос исполнился в контексте {tenantId:null} (см. выше).
  let threw = false;
  try {
    await TenantContext.run({ tenantId: null, system: false }, async () => {
      await prisma.student.findMany();
    });
  } catch {
    threw = true;
  }
  check('доменный запрос без тенанта (не system) → отказ', threw);

  // ── AR-34 (G-11): интерсептор fail-closed — аутентифицированный без школы НЕ получает system ──
  {
    const interceptor = new TenantInterceptor(prisma);
    const store = await (
      interceptor as unknown as {
        resolveStore(req: { user?: { florusUserId: string } }): Promise<{ tenantId: string | null; system: boolean }>;
      }
    ).resolveStore({ user: { florusUserId: 'no-such-user-ar34' } });
    check('аутентифицирован без школы → {tenantId:null, system:false} (не обход)', store.tenantId === null && store.system === false);
  }

  // ── строка B не пострадала от кросс-тенант записи ──
  const bAfter = await TenantContext.runAsSystem(() =>
    prisma.student.findUnique({ where: { id: studentB.id } }),
  );
  check('строка B не изменена (firstName != HACK)', bAfter?.firstName === 'S');

  await reset(prisma);
  await app.close();
  console.log(`\n${fail === 0 ? '✓ ИЗОЛЯЦИЯ ТЕНАНТА РАБОТАЕТ' : '✗ ЕСТЬ ПРОБОИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
