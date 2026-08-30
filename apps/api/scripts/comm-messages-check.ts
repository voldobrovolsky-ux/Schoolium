/**
 * e2e Communitoria чанк 2 (каналы/сообщения/объявления). Ключевое доказательство: mode НЕ угадывается
 * системой — без явного mode создание сообщения ПАДАЕТ (MODE_REQUIRED), а не дефолтится молча; advisory
 * suggestMode не создаёт сообщение и не применяет режим. Плюс: инвариант миноров ПЕРЕИСПОЛЬЗУЕТСЯ через
 * тот же ChannelService.addParticipant (не дублируется); keyset-пагинация; правка=edited (история цела);
 * объявление→required-set→ack→overdue→reconcile (ушёл из школы). Запуск: npm run comm:check.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ChannelService } from '../src/modules/comm/channel.service';
import { MessageService } from '../src/modules/comm/message.service';
import { AnnouncementService } from '../src/modules/comm/announcement.service';
import { ParenthoodSync } from '../src/modules/comm/parenthood.sync';
import { COMM_ERRORS, COMM_EVENTS } from '../src/modules/comm/comm.contract';

const WS = 'comm2-ws';
const T1 = 'comm2-teacher';
const P1 = 'comm2-parent-1';
const P2 = 'comm2-parent-2';
const EXT = 'comm2-external';
const CLS = 'comm2-class';
const S1 = 'comm2-s1';
const S2 = 'comm2-s2';

async function cleanup(prisma: PrismaService) {
  await TenantContext.runAsSystem(async () => {
    await prisma.ack.deleteMany({ where: { workspaceId: WS } });
    await prisma.messageReaction.deleteMany({ where: { workspaceId: WS } });
    await prisma.message.deleteMany({ where: { workspaceId: WS } });
    await prisma.channelParticipant.deleteMany({ where: { workspaceId: WS } });
    await prisma.channel.deleteMany({ where: { workspaceId: WS } });
    await prisma.parenthood.deleteMany({ where: { workspaceId: WS } });
    await prisma.student.deleteMany({ where: { workspaceId: WS } });
    await prisma.class.deleteMany({ where: { workspaceId: WS } });
    await prisma.membership.deleteMany({ where: { workspaceId: WS } });
    await prisma.outboxEvent.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { in: [T1, P1, P2, EXT] } } });
  });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const channels = app.get(ChannelService);
  const messages = app.get(MessageService);
  const announcements = app.get(AnnouncementService);
  const sync = app.get(ParenthoodSync);

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };
  const expectThrow = async (name: string, fn: () => Promise<unknown>, code?: string) => {
    try {
      await fn();
      check(name, false);
    } catch (e) {
      const got = (e as { response?: { code?: string } })?.response?.code;
      check(name, code ? got === code : true);
    }
  };

  await cleanup(prisma);
  await TenantContext.runAsSystem(async () => {
    await prisma.organization.upsert({ where: { id: 'org-edustore-platform' }, update: {}, create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' } });
    await prisma.workspace.create({ data: { id: WS, orgId: 'org-edustore-platform', name: 'comm2' } });
    for (const [id, fn] of [[T1, 'Учитель'], [P1, 'Родитель1'], [P2, 'Родитель2'], [EXT, 'Гость']] as const) {
      await prisma.user.create({ data: { id, firstName: fn, lastName: 'Т', displayName: `${fn} Т` } });
    }
    // членства в ЭТОЙ школе (EXT — без членства = ушёл/внешний)
    await prisma.membership.create({ data: { florusUserId: T1, workspaceId: WS, florusRole: 'teacher' } });
    await prisma.membership.create({ data: { florusUserId: P1, workspaceId: WS, florusRole: 'parent' } });
    await prisma.membership.create({ data: { florusUserId: P2, workspaceId: WS, florusRole: 'parent' } });
    await prisma.class.create({ data: { id: CLS, workspaceId: WS, parallel: 6, letter: 'Б', label: '6Б' } });
    let n = 0;
    for (const id of [S1, S2]) await prisma.student.create({ data: { id, workspaceId: WS, classId: CLS, number: ++n, firstName: `У${n}`, lastName: 'Т', displayName: `У${n} Т` } });
    await sync.syncEdge({ workspaceId: WS, parentUserId: P1, studentId: S1 });
    await sync.syncEdge({ workspaceId: WS, parentUserId: P2, studentId: S2 });
  });

  await TenantContext.run({ tenantId: WS, system: false }, async () => {
    // ── создание канала: создатель = первый модератор ──
    const ch = await channels.createChannel({ kind: 'class', title: '6Б', classId: CLS }, T1);
    check('создатель канала стал модератором', (await channels.isModerator(ch.id, T1)) === true);
    check('не-создатель — не модератор', (await channels.isModerator(ch.id, P1)) === false);

    // ── КЛЮЧЕВОЙ ИНВАРИАНТ: mode НЕ угадывается ──
    await expectThrow('POST без mode → падает (MODE_REQUIRED), не дефолтится', () => messages.postMessage(ch.id, T1, { body: 'привет' }), COMM_ERRORS.modeRequired);
    await expectThrow('POST с невалидным mode → 400', () => messages.postMessage(ch.id, T1, { mode: 'auto', body: 'x' }));
    const m1 = await messages.postMessage(ch.id, T1, { mode: 'chat', kind: 'text', body: 'сообщение 1' });
    check('POST с явным mode=chat → создано, mode=chat', m1.mode === 'chat');
    // advisory: подсказка НЕ создаёт сообщение и НЕ применяет режим
    const before = await prisma.message.count({ where: { channelId: ch.id } });
    const suggestion = messages.suggestMode('Объявление: собрание в пятницу');
    const after = await prisma.message.count({ where: { channelId: ch.id } });
    check('suggestMode вернул advisory (announcement)', suggestion.aiSuggestedMode === 'announcement' && suggestion.advisory === true);
    check('suggestMode НЕ создал сообщение (advisory-only)', before === after);

    // ── ПЕРЕИСПОЛЬЗОВАНИЕ инварианта миноров через тот же addParticipant ──
    const chMinor = await channels.createChannel({ kind: 'school', title: 'минор-тест' }, T1);
    await channels.addParticipant(chMinor.id, { studentId: S1, role: 'student' });
    check('канал с минором: minorPresent=true (через chunk-2 путь)', (await channels.getChannel(chMinor.id))?.minorPresent === true);
    await expectThrow('external в канал с минором → тот же инвариант (MINOR_CHANNEL_NO_EXTERNAL)', () => channels.addParticipant(chMinor.id, { userId: EXT, role: 'external' }), COMM_ERRORS.minorChannelNoExternal);

    // ── keyset-пагинация ленты ──
    const m2 = await messages.postMessage(ch.id, T1, { mode: 'chat', body: 'сообщение 2' });
    const m3 = await messages.postMessage(ch.id, T1, { mode: 'chat', body: 'сообщение 3' });
    const page1 = await messages.listMessages(ch.id, { limit: 2 });
    const page2 = await messages.listMessages(ch.id, { cursor: page1.nextCursor ?? undefined, limit: 2 });
    const seen = new Set([...page1.items, ...page2.items].map((x) => x.id));
    check('пагинация: page1=2, nextCursor задан', page1.items.length === 2 && !!page1.nextCursor);
    check('пагинация: все 3 сообщения покрыты без дублей', seen.size === 3 && seen.has(m1.id) && seen.has(m2.id) && seen.has(m3.id));
    await expectThrow('пагинация: битый курсор → ошибка (не тихо страница 1)', () => messages.listMessages(ch.id, { cursor: 'no-such-message' }));

    // ── постить может только участник/модератор (закрытие обхода инварианта миноров на уровне сообщений) ──
    await expectThrow('не-участник не может писать (NOT_CHANNEL_PARTICIPANT)', () => messages.postMessage(ch.id, P1, { mode: 'chat', body: 'x' }), 'NOT_CHANNEL_PARTICIPANT');
    await channels.addParticipant(ch.id, { userId: P1, role: 'parent' });
    const pmsg = await messages.postMessage(ch.id, P1, { mode: 'chat', body: 'от родителя-участника' });
    check('участник (после добавления) может писать', pmsg.mode === 'chat');

    // ── правка: edited=true, история не стёрта; реакция ──
    const edited = await messages.editMessage(m1.id, 'сообщение 1 (правка)');
    const stillThere = await prisma.message.findUnique({ where: { id: m1.id } });
    check('правка: edited=true, тело обновлено, сообщение НЕ удалено', edited.edited === true && stillThere?.body === 'сообщение 1 (правка)' && stillThere !== null);
    await messages.addReaction(m1.id, T1, '👍');
    check('реакция добавлена', (await prisma.messageReaction.count({ where: { messageId: m1.id } })) === 1);

    // ── объявление → required-set → ack → overdue → reconcile ──
    const past = new Date(Date.now() - 60_000).toISOString();
    const { announcement, requiredCount } = await announcements.postAnnouncement(ch.id, T1, { body: 'Родительское собрание', audience: 'parents', ackDeadline: past });
    check('объявление: required-set = родители класса (P1,P2)', requiredCount === 2);
    check('объявление персистится как Message mode=announcement', announcement.mode === 'announcement' && announcement.audience === 'parents');
    await announcements.recordAck(announcement.id, P1);
    const reg1 = await announcements.listAcks(announcement.id);
    check('реестр: P1=acknowledged, P2=overdue (просрочен, не подтвердил)', reg1.counts['acknowledged'] === 1 && reg1.counts['overdue'] === 1 && reg1.required === 2);

    // P2 ушёл из школы → удаление членства → выпадает из required-set (не вечный overdue)
    await TenantContext.runAsSystem(() => prisma.membership.deleteMany({ where: { workspaceId: WS, florusUserId: P2 } }));
    const reg2 = await announcements.listAcks(announcement.id);
    check('reconcile: ушедший из школы (P2) убран из required-set', reg2.required === 1 && !reg2.acks.some((a) => a.userId === P2));

    // ── события эмитированы ──
    const evt = async (type: string) => TenantContext.runAsSystem(() => prisma.outboxEvent.count({ where: { workspaceId: WS, type } }));
    check('событие comm.message.sent эмитировано', (await evt(COMM_EVENTS.messageSent)) >= 1);
    check('событие comm.announcement.posted эмитировано', (await evt(COMM_EVENTS.announcementPosted)) === 1);
    check('событие comm.ack.recorded эмитировано', (await evt(COMM_EVENTS.ackRecorded)) === 1);
  });

  await cleanup(prisma);
  await app.close();
  console.log(`\n${fail === 0 ? '✓ КАНАЛЫ/СООБЩЕНИЯ OK' : '✗ ЕСТЬ ПРОБОИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
