/**
 * G-15 (AR-38) — авторинг Timetable сквозной: сетка создаётся через API движка (не seed),
 * Solver работает на созданных руками данных.
 * Доказывает: (а) upsertTimetable создаёт сетку (типовая неделя) с событием;
 * (б) INSUFFICIENT_SLOTS воспроизводится на маленькой сетке; (в) достаточная сетка →
 * КПП scheduled; (г) TIMETABLE_IN_USE защищает сетку под живой раскладкой КПП;
 * (д) BAD_SLOT отклоняет слот вне диапазона.
 * Запуск: npm run timetable:check (нужен Postgres).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { EngineService } from '../src/modules/engine/engine.service';

const WS = 'ws-timetable-check';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const engine = app.get(EngineService);

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };
  const codeOf = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return '';
    } catch (e) {
      return ((e as { response?: { code?: string } }).response?.code ?? '') as string;
    }
  };

  const ids = await TenantContext.runAsSystem(async () => {
    // очистка в порядке FK
    await prisma.lesson.deleteMany({ where: { workspaceId: WS } });
    await prisma.kppMapping.deleteMany({ where: { workspaceId: WS } });
    await prisma.kppLesson.deleteMany({ where: { workspaceId: WS } });
    await prisma.kpp.deleteMany({ where: { workspaceId: WS } });
    await prisma.timetableSlot.deleteMany({ where: { workspaceId: WS } });
    await prisma.timetable.deleteMany({ where: { workspaceId: WS } });
    await prisma.ktpTopic.deleteMany({ where: { workspaceId: WS } });
    await prisma.ktp.deleteMany({ where: { workspaceId: WS } });
    await prisma.subject.deleteMany({ where: { workspaceId: WS } });
    await prisma.class.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });

    const platform = await prisma.organization.upsert({
      where: { id: 'org-edustore-platform' },
      update: {},
      create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' },
    });
    await prisma.workspace.create({ data: { id: WS, orgId: platform.id, name: 'Timetable Check' } });
    const klass = await prisma.class.create({ data: { workspaceId: WS, parallel: 6, letter: 'Т', label: '6Т' } });
    const subject = await prisma.subject.create({ data: { workspaceId: WS, name: 'Геометрия-ТЧ', color: '#777777' } });
    // КТП: 2 темы × 2 часа = 4 требуемых слота
    const ktp = await prisma.ktp.create({
      data: {
        workspaceId: WS,
        classId: klass.id,
        disciplineId: subject.id,
        status: 'draft',
        topics: {
          create: [
            { workspaceId: WS, title: 'Тема 1', order: 1, fgosHours: 2, arCodes: ['AR-T-1'] },
            { workspaceId: WS, title: 'Тема 2', order: 2, fgosHours: 2, arCodes: ['AR-T-2'] },
          ],
        },
      },
    });
    return { classId: klass.id, disciplineId: subject.id, ktpId: ktp.id };
  });

  await TenantContext.run({ tenantId: WS, system: false }, async () => {
    // (д) слот вне диапазона отклоняется
    check(
      'слот day=9 → BAD_SLOT',
      (await codeOf(engine.upsertTimetable(ids.classId, [{ day: 9, position: 1 }], 'zavuch-check'))) === 'BAD_SLOT',
    );

    // (а) сетка создаётся через API (2 слота, типовая неделя)
    const small = await engine.upsertTimetable(
      ids.classId,
      [
        { day: 1, position: 1 },
        { day: 3, position: 2 },
      ],
      'zavuch-check',
    );
    check('сетка создана через API (2 слота)', small.slots.length === 2 && small.source === 'zavuch-manual');

    // approve КТП (событие дёрнет солвер — тот честно упадёт на нехватке; проверяем кодом ниже)
    await engine.approveKtp(ids.ktpId, 'zavuch-check');

    // (б) Solver: 4 требуемых часа > 2 слота → INSUFFICIENT_SLOTS
    check(
      'Solver на маленькой сетке → INSUFFICIENT_SLOTS',
      (await codeOf(engine.generateKpp(ids.classId, ids.disciplineId))) === 'INSUFFICIENT_SLOTS',
    );

    // (в) расширяем сетку через тот же API → Solver раскладывает
    const full = await engine.upsertTimetable(
      ids.classId,
      [1, 2, 3, 4].map((i) => ({ day: i, position: 1 })),
      'zavuch-check',
    );
    check('сетка заменена (4 слота)', full.slots.length === 4);
    const kpp = await engine.generateKpp(ids.classId, ids.disciplineId);
    check('Solver разложил КПП по созданной руками сетке', kpp.status === 'scheduled');

    // (г) сетка под живой раскладкой защищена
    check(
      'пересборка сетки под КПП → TIMETABLE_IN_USE',
      (await codeOf(engine.upsertTimetable(ids.classId, [{ day: 1, position: 1 }], 'zavuch-check'))) === 'TIMETABLE_IN_USE',
    );
  });

  await app.close();
  console.log(`\n${fail === 0 ? '✓ АВТОРИНГ СЕТКИ РАБОТАЕТ' : '✗ ЕСТЬ ПРОБОИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
