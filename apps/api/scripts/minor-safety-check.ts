/**
 * e2e ИНВАРИАНТОВ БЕЗОПАСНОСТИ МИНОРОВ (Communitoria, чанк 1) — ОТДЕЛЬНАЯ ось от tenant:check.
 * Здесь участвуют несовершеннолетние: инвариант проверяется ПЕРВЫМ, до каналов/сообщений.
 * Поднимает реальный Nest-контекст (те же сервисы графа/каналов + tenant-guard) и доказывает:
 *   (а) родитель ↔ СВОЙ ребёнок — приватный DM разрешён (по ребру parenthood);
 *   (б) взрослый (не родитель этого ребёнка) ↔ чужой минор без наблюдателя — запрещено;
 *   (в) попытка добавить `external` в канал с минором — отклонено на уровне добавления участника.
 * Плюс: двойная роль (учитель-он-же-родитель → к своему по ребру, к чужому запрещено), минор↔минор,
 * взрослый↔взрослый. Запуск: npm run minor:check (нужен поднятый Postgres).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { GraphService } from '../src/modules/comm/graph.service';
import { ChannelService } from '../src/modules/comm/channel.service';
import { ParenthoodSync } from '../src/modules/comm/parenthood.sync';
import { COMM_ERRORS } from '../src/modules/comm/comm.contract';

const WS = 'comm-test-ws';
const P1 = 'comm-user-parent-1'; // родитель S1
const T2 = 'comm-user-teacher-2'; // учитель, НЕ родитель S1
const TP = 'comm-user-teacherparent'; // учитель И родитель S3 (двойная роль)
const CLS = 'comm-test-class';
const S1 = 'comm-stu-1'; // ребёнок P1
const S2 = 'comm-stu-2'; // без родителя в системе
const S3 = 'comm-stu-3'; // ребёнок TP

async function cleanup(prisma: PrismaService) {
  await TenantContext.runAsSystem(async () => {
    await prisma.channelParticipant.deleteMany({ where: { workspaceId: WS } });
    await prisma.channel.deleteMany({ where: { workspaceId: WS } });
    await prisma.parenthood.deleteMany({ where: { workspaceId: WS } });
    await prisma.student.deleteMany({ where: { workspaceId: WS } });
    await prisma.class.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { in: [P1, T2, TP] } } });
  });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const graph = app.get(GraphService);
  const channels = app.get(ChannelService);
  const sync = app.get(ParenthoodSync);

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };
  // ожидаем ForbiddenException с конкретным кодом инварианта
  const expectBlocked = async (name: string, fn: () => Promise<unknown>, code: string) => {
    try {
      await fn();
      check(`${name} → ЗАБЛОКИРОВАНО`, false);
    } catch (e) {
      const got = (e as { response?: { code?: string } })?.response?.code;
      check(`${name} → ЗАБЛОКИРОВАНО (${code})`, got === code);
    }
  };
  const expectAllowed = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      check(`${name} → разрешено`, true);
    } catch (e) {
      console.log('   неожиданно брошено:', (e as Error).message);
      check(`${name} → разрешено`, false);
    }
  };

  await cleanup(prisma);

  // setup: платформа + школа; взрослые (User); класс; миноры (Student); рёбра parenthood (зеркало Флёруса)
  await TenantContext.runAsSystem(async () => {
    await prisma.organization.upsert({
      where: { id: 'org-edustore-platform' },
      update: {},
      create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' },
    });
    await prisma.workspace.create({ data: { id: WS, orgId: 'org-edustore-platform', name: 'Test comm' } });
    for (const [id, fn] of [[P1, 'Родитель'], [T2, 'Учитель'], [TP, 'УчительРодитель']] as const) {
      await prisma.user.create({ data: { id, firstName: fn, lastName: 'Тест', displayName: `${fn} Тест` } });
    }
    await prisma.class.create({ data: { id: CLS, workspaceId: WS, parallel: 5, letter: 'А', label: '5А' } });
    let n = 0;
    for (const id of [S1, S2, S3]) {
      await prisma.student.create({
        data: { id, workspaceId: WS, classId: CLS, number: ++n, firstName: `Ученик${n}`, lastName: 'Т', displayName: `Ученик${n} Т` },
      });
    }
    // рёбра из директории Флёруса (единственный писатель — ParenthoodSync)
    await sync.syncEdge({ workspaceId: WS, parentUserId: P1, studentId: S1 });
    await sync.syncEdge({ workspaceId: WS, parentUserId: TP, studentId: S3 });
  });

  // все проверки — в tenant-контексте школы (parenthood tenant-scoped)
  await TenantContext.run({ tenantId: WS, system: false }, async () => {
    // ── (а) родитель ↔ свой ребёнок — разрешено ──
    await expectAllowed('(а) родитель P1 ↔ свой ребёнок S1', () => graph.assertPrivateDmAllowed({ userId: P1 }, { studentId: S1 }));

    // ── (б) взрослый (не родитель) ↔ чужой минор без наблюдателя — запрещено ──
    await expectBlocked('(б) учитель T2 ↔ чужой минор S1', () => graph.assertPrivateDmAllowed({ userId: T2 }, { studentId: S1 }), COMM_ERRORS.minorDmRequiresParenthood);
    await expectBlocked('(б) родитель P1 ↔ НЕ свой минор S2', () => graph.assertPrivateDmAllowed({ userId: P1 }, { studentId: S2 }), COMM_ERRORS.minorDmRequiresParenthood);

    // ── двойная роль: учитель-он-же-родитель → к своему по ребру, к чужому запрещено ──
    await expectAllowed('двойная роль TP ↔ свой ребёнок S3', () => graph.assertPrivateDmAllowed({ userId: TP }, { studentId: S3 }));
    await expectBlocked('двойная роль TP ↔ чужой минор S1 (роль учителя не помогает)', () => graph.assertPrivateDmAllowed({ userId: TP }, { studentId: S1 }), COMM_ERRORS.minorDmRequiresParenthood);

    // ── минор↔минор запрещён; взрослый↔взрослый разрешён ──
    await expectBlocked('минор S1 ↔ минор S2', () => graph.assertPrivateDmAllowed({ studentId: S1 }, { studentId: S2 }), COMM_ERRORS.minorMinorDmForbidden);
    await expectAllowed('взрослый P1 ↔ взрослый T2', () => graph.assertPrivateDmAllowed({ userId: P1 }, { userId: T2 }));

    // ── (в) канал с минором не принимает external — на уровне добавления участника ──
    const ch = await channels.createChannel({ kind: 'group', title: 'Тест-канал' });
    await channels.addParticipant(ch.id, { userId: P1, role: 'parent' });
    await channels.addParticipant(ch.id, { studentId: S1, role: 'student' }); // → minorPresent=true
    const afterMinor = await channels.getChannel(ch.id);
    check('канал с минором: minorPresent=true', afterMinor?.minorPresent === true);
    await expectBlocked('(в) добавить external в канал с минором', () => channels.addParticipant(ch.id, { userId: 'ext-guest', role: 'external' }), COMM_ERRORS.minorChannelNoExternal);

    // обратное направление: канал с external НЕ принимает минора
    const ch2 = await channels.createChannel({ kind: 'group', title: 'Тест-канал-2' });
    await channels.addParticipant(ch2.id, { userId: 'ext-guest', role: 'external' });
    await expectBlocked('(в) добавить минора в канал с external', () => channels.addParticipant(ch2.id, { studentId: S2, role: 'student' }), COMM_ERRORS.minorChannelNoExternal);
  });

  await cleanup(prisma);
  await app.close();
  console.log(`\n${fail === 0 ? '✓ ИНВАРИАНТЫ МИНОРОВ ДЕРЖАТСЯ' : '✗ ЕСТЬ ПРОБОИ БЕЗОПАСНОСТИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
