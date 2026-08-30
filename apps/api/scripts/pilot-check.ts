/**
 * e2e ВРЕМЕННОГО пилотного auth (AUTH_MODE=pilot-qr). Доказывает поток и — КРИТИЧНО — что сессия
 * QR-пути несёт ТУ ЖЕ форму (role/workspace_id), что выдаст настоящий Флёр OIDC, и одинаково гейтит
 * RBAC. Поток: создать сотрудника → QR → вход → «подготавливаем» → owner назначает → «готово».
 * Запуск: npm run pilot:check (нужен поднятый Postgres).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { FlorService } from '../src/common/auth/flor.service';
import { AuthzService } from '../src/common/authz/authz.service';
import { PilotService } from '../src/modules/pilot/pilot.service';
import { ARCHIMED_FLOR_WS_ID } from '../src/modules/pilot/pilot.contract';

async function cleanup(prisma: PrismaService) {
  await TenantContext.runAsSystem(async () => {
    const ws = await prisma.workspace.findUnique({ where: { florusWorkspaceId: ARCHIMED_FLOR_WS_ID } });
    if (!ws) return;
    const invites = await prisma.pilotInvite.findMany({ where: { workspaceId: ws.id } });
    const userIds = invites.flatMap((i) => (i.userId ? [i.userId] : []));
    await prisma.pilotInvite.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.teachingAssignment.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.teacher.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.subject.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.class.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.session.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.membership.deleteMany({ where: { workspaceId: ws.id } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.workspace.delete({ where: { id: ws.id } });
  });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const pilot = app.get(PilotService);
  const flor = app.get(FlorService);
  const authz = app.get(AuthzService);

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };

  await cleanup(prisma);

  // ── owner добавляет учителя → QR-инвайт ──
  const invT = await pilot.createInvite({ role: 'teacher', displayName: 'Пётр Учитель' });
  check('createInvite(teacher) → токен выдан', !!invT.token && invT.role === 'teacher');
  const staff0 = await pilot.listStaff();
  check('сотрудник виден в списке сразу (visible), но не вошёл', staff0.length === 1 && staff0[0].loggedIn === false && staff0[0].assigned === false);

  // ── вход по QR: резолв по ТОКЕНУ (не по телефону) ──
  const { sid, userId } = await pilot.resolveInvite({ token: invT.token, phone: '+79990001122' });
  check('QR-вход создал сессию', !!sid && !!userId);
  await TenantContext.runAsSystem(async () => {
    check('создан User', (await prisma.user.count({ where: { id: userId } })) === 1);
    check('создан Teacher', (await prisma.teacher.count({ where: { id: userId } })) === 1);
    const m = await prisma.membership.findFirst({ where: { florusUserId: userId } });
    check('создан Membership florusRole=teacher', m?.florusRole === 'teacher' && m?.subRole === null);
    const inv = await prisma.pilotInvite.findUnique({ where: { id: invT.inviteId } });
    check('инвайт active, телефон — ярлык (не идентификатор)', inv?.status === 'active' && inv?.userId === userId && inv?.phone === '+79990001122');
  });

  // ── КРИТИЧНО: форма сессии = как у Флёр OIDC (role + workspace_id) ──
  const session = await flor.getSession(sid);
  check('сессия: role=teacher, subRole=null (форма OIDC)', session?.role === 'teacher' && session?.subRole === null);
  check('сессия: florusWorkspaceId = постоянный Архимед-id', session?.florusWorkspaceId === ARCHIMED_FLOR_WS_ID && !!session?.workspaceId);
  const accessT = await authz.resolveAccess(session!.role, session!.subRole);
  check('RBAC по пилотной сессии = как по Флёр (teacher имеет materials.textbook.upload)', accessT.permissions.includes('materials.textbook.upload'));

  // ── «не назначен» → спокойный статус-экран ──
  const st1 = await pilot.cabinetState(userId);
  check('кабинет «preparing» (нет дисциплины/класса) — не ошибка, спокойный статус', st1.state === 'preparing' && !!st1.message);

  // ── owner создаёт дисциплину/класс (переиспользует Structure) и назначает ──
  const subj = await pilot.createSubject({ name: 'Математика' });
  const cls = await pilot.createClass({ parallel: 5, letter: 'А' });
  await pilot.assign({ userId, classId: cls.id, subjectId: subj.id });
  const st2 = await pilot.cabinetState(userId);
  check('после назначения — кабинет «ready»', st2.state === 'ready');
  const staff1 = await pilot.listStaff();
  check('список: сотрудник loggedIn+assigned', staff1[0].loggedIn === true && staff1[0].assigned === true);

  // ── завуч: та же форма → role=staff, subRole=zavuch ──
  const invZ = await pilot.createInvite({ role: 'zavuch', displayName: 'Зоя Завуч' });
  const z = await pilot.resolveInvite({ token: invZ.token, phone: '+79990002233' });
  const zSession = await flor.getSession(z.sid);
  check('завуч: сессия role=staff, subRole=zavuch (форма OIDC)', zSession?.role === 'staff' && zSession?.subRole === 'zavuch');
  const accessZ = await authz.resolveAccess(zSession!.role, zSession!.subRole);
  check('RBAC: завуч имеет comm.announcement.post (пакет zavuch)', accessZ.permissions.includes('comm.announcement.post'));

  // ── A5: повторный QR + отзыв приглашения ──
  const invR = await pilot.createInvite({ role: 'teacher', displayName: 'Отзываемый' });
  const staffR = await pilot.listStaff();
  const rowR = staffR.find((x) => x.inviteId === invR.inviteId);
  check('listStaff отдаёт token не-вошедшему (повторный QR)', rowR?.token === invR.token);
  const rowT = staffR.find((x) => x.inviteId === invT.inviteId);
  check('после входа token скрыт, назначения с ярлыками', rowT?.token === null && (rowT?.assignments[0] ?? '').includes('5А'));
  await pilot.revokeInvite(invR.inviteId);
  check('отзыв не-вошедшего: приглашение удалено', !(await pilot.listStaff()).some((x) => x.inviteId === invR.inviteId));
  let revokeBlocked = false;
  try {
    await pilot.revokeInvite(invT.inviteId);
  } catch {
    revokeBlocked = true;
  }
  check('отзыв ВОШЕДШЕГО заблокирован (INVITE_ACTIVE)', revokeBlocked);

  // ── постоянство workspace: повторный ensureArchimed не плодит школу ──
  await pilot.createInvite({ role: 'teacher' });
  const wsCount = await TenantContext.runAsSystem(() => prisma.workspace.count({ where: { florusWorkspaceId: ARCHIMED_FLOR_WS_ID } }));
  check('Архимед — один постоянный workspace (florusWorkspaceId стабилен)', wsCount === 1);

  await cleanup(prisma);
  await app.close();
  console.log(`\n${fail === 0 ? '✓ ПИЛОТНЫЙ AUTH OK' : '✗ ЕСТЬ ПРОБОИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
