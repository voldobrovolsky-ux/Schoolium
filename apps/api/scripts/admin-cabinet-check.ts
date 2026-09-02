/**
 * G-81, G-82 (AR-186…AR-189, AR-193, AR-194) — **кабинет администратора и
 * кабинет завуча доказаны перечислением.**
 *
 *   · три кабинета — три права: `school.admin` только у администратора,
 *     `school.oversee` у завуча и администратора, модератору чужие закрыты;
 *   · каждая мутация `AdminCabinetController` гейчена `school.admin`;
 *   · ссылка входа с карточки: 48 часов, одноразова, вход по ней активирует
 *     учётку и даёт сессию канала `login_link` (AR-189);
 *   · происхождение сессии хранится: вид клиента, адрес, родительская сессия
 *     скана (AR-187);
 *   · лимит сессий роли гасит самую давнюю, а не отклоняет вход (AR-188);
 *   · инцидент-режим закрывает все сессии школы, кроме текущей (AR-188);
 *   · реестры сети и устройств изолированы по школе (G-82) и аудируются;
 *   · чек-лист завуча выведен из данных: пустая школа — всё не готово,
 *     работающая — УТЦ закрыт (AR-193);
 *   · «новая сеть» — первая сессия из этой /24 в истории человека;
 *   · журнал подключений чистится по сроку `sessionJournalDays` (AR-194).
 *
 * Запуск: npm --workspace apps/api run admin:check
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ACCESS_PARAMS } from '@edustore/shared';
import { REQUIRE_PERMISSION } from '../src/common/authz/require-permission.decorator';
import { AuthzService } from '../src/common/authz/authz.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { SchoolSessionService } from '../src/common/auth/school-session.service';
import { AccessService } from '../src/schoolium/access/access.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { AdminCabinetService } from '../src/schoolium/cabinets/admin-cabinet.service';
import { DeputyCabinetService } from '../src/schoolium/cabinets/deputy-cabinet.service';
import { SCHOOL_EVENTS } from '../src/schoolium/schoolium.contract';
import { bench, bootstrapSchool, check, inSchool, makeStaff, readySchool, refuses, report } from './schoolium/harness';

const MUTATIONS = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function main(): Promise<void> {
  const b = await bench();
  const authz = b.get(AuthzService);
  const sessions = b.get(SchoolSessionService);
  const access = b.get(AccessService);
  const staff = b.get(StaffService);
  const admin = b.get(AdminCabinetService);
  const deputy = b.get(DeputyCabinetService);
  const sys = <T>(fn: () => Promise<T>) => TenantContext.runAsSystem(fn);
  const drain = () => sys(() => b.outbox.drain());

  console.log('G-81 · кабинет администратора и кабинет завуча (AR-186…AR-189, AR-193)\n');

  // ─── 1. три кабинета — три права ───
  const adminAcc = await authz.resolveForRoles(['admin']);
  const modAcc = await authz.resolveForRoles(['moderator']);
  const depAcc = await authz.resolveForRoles(['deputy_academic']);
  check(adminAcc.permissions.includes('school.admin') && adminAcc.permissions.includes('school.oversee'),
    'администратор держит school.admin и school.oversee — все три кабинета открыты ему (AR-186)');
  check(!modAcc.permissions.includes('school.admin') && !modAcc.permissions.includes('school.oversee'),
    'модератор НЕ держит school.admin и school.oversee — кабинеты администратора и завуча ему закрыты');
  check(depAcc.permissions.includes('school.oversee') && !depAcc.permissions.includes('school.manage') && !depAcc.permissions.includes('school.admin'),
    'завуч держит school.oversee и не держит ни school.manage, ни school.admin — надзор без управления (AR-193)');

  // ─── 2. каждая мутация кабинета администратора гейчена school.admin ───
  const container = b.app.get(ModulesContainer);
  const routes: { ctrl: string; route: string; method: RequestMethod; perm: string | string[] | undefined }[] = [];
  for (const m of container.values()) {
    for (const [, w] of m.controllers) {
      const ctor = w.metatype as (new () => unknown) | undefined;
      if (!ctor) continue;
      if (!['AdminCabinetController', 'DeputyCabinetController', 'ModeratorCabinetController'].includes(ctor.name)) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, ctor) ?? '');
      const proto = ctor.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const h = proto[name] as object;
        if (typeof h !== 'function') continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, h);
        if (method === undefined) continue;
        const path = String(Reflect.getMetadata(PATH_METADATA, h) ?? '');
        routes.push({ ctrl: ctor.name, route: `/${base}/${path}`.replace(/\/+/g, '/'), method, perm: Reflect.getMetadata(REQUIRE_PERMISSION, h) });
      }
    }
  }
  const adminMut = routes.filter((r) => r.ctrl === 'AdminCabinetController' && MUTATIONS.has(r.method));
  check(adminMut.length === 9, `мутаций кабинета администратора: ${adminMut.length} (§11 строки 40–48 без ссылки входа — её несёт StaffController)`);
  check(adminMut.every((r) => r.perm === 'school.admin'),
    `каждая мутация /v1/admin гейчена school.admin: ${adminMut.map((r) => r.route).join(', ')}`);
  const adminReads = routes.filter((r) => r.ctrl === 'AdminCabinetController' && !MUTATIONS.has(r.method));
  check(adminReads.length > 0 && adminReads.every((r) => r.perm === 'school.admin'),
    `и каждое чтение /v1/admin тоже — карта устройств и аудит школы не читаются модератором (${adminReads.length} маршрутов)`);
  const depRoutes = routes.filter((r) => r.ctrl === 'DeputyCabinetController');
  check(depRoutes.length === 1 && !MUTATIONS.has(depRoutes[0].method) && depRoutes[0].perm === 'school.oversee' && depRoutes[0].route === '/v1/deputy/',
    'кабинет завуча — ровно одно чтение /v1/deputy за school.oversee, мутаций нет (AR-193)');
  const modRoutes = routes.filter((r) => r.ctrl === 'ModeratorCabinetController');
  check(modRoutes.length === 1 && modRoutes[0].route === '/v1/moderator/' && modRoutes[0].perm === 'school.manage',
    'кабинет модератора переехал на /v1/moderator за school.manage — прежний /v1/admin отдан администратору (AR-186)');
  const loginLinkRoute = routes.find((r) => r.route === '/v1/staff/:id/login-link');
  check(loginLinkRoute === undefined || loginLinkRoute.perm === 'school.admin', 'маршрут ссылки входа не в перечне кабинетов — проверяется ниже по факту');

  // ─── 3. ссылка входа с карточки (AR-189) ───
  const a = await bootstrapSchool(b, 'Школа администратора');
  const adminActor = { ...a.moderator, roles: ['admin' as const, 'moderator' as const] };
  const teacher = await makeStaff(b, a, ['teacher'], 'Иванова Мария');
  const before = await sys(() => b.prisma.membership.findFirst({ where: { userId: teacher.userId, workspaceId: a.workspaceId } }));
  check(before?.activatedAt === null, 'до входа по ссылке учётка сотрудника не активирована');

  const link = await inSchool(a.workspaceId, () => staff.issueLoginLink(teacher.cardId, adminActor, 'https://school.example'));
  check(link.url === `https://school.example/bootstrap/${link.token}`, `ссылка строится от публичного origin: ${link.url}`);
  const linkRow = await sys(() => b.prisma.bootstrapLink.findUnique({ where: { token: link.token } }));
  check(linkRow?.purpose === 'login_link' && linkRow?.issuedBy === a.moderator.userId,
    'строка ссылки: purpose = login_link, issuedBy = администратор — аудит различит её с платформенной');
  const ttlH = Math.round(((linkRow?.expiresAt.getTime() ?? 0) - Date.now()) / HOUR);
  check(ttlH === ACCESS_PARAMS.loginLinkTtlHours, `срок ссылки — ${ttlH} часов (AR-189: ${ACCESS_PARAMS.loginLinkTtlHours})`);

  const entered = await access.useBootstrapLink(link.token, { deviceHint: 'телефон сотрудника', clientKind: 'pwa', ip: '10.1.2.3' });
  await drain();
  const linkSession = await sys(() => b.prisma.appSession.findUnique({ where: { token: entered.session.token } }));
  check(linkSession?.via === 'login_link', `сессия по ссылке с карточки несёт канал ${linkSession?.via} (не bootstrap_link)`);
  const after = await sys(() => b.prisma.membership.findFirst({ where: { userId: teacher.userId, workspaceId: a.workspaceId } }));
  check(after?.activatedAt !== null, 'вход по ссылке поставил activatedAt — учётка ушла из «Не авторизованных» (AR-161)');
  await refuses(() => access.useBootstrapLink(link.token, 'ещё раз'), 'TOKEN_USED', 'повторное использование ссылки');
  const issuedAudit = await sys(() => b.prisma.auditLog.findFirst({ where: { workspaceId: a.workspaceId, action: SCHOOL_EVENTS.loginLinkIssued } }));
  check(issuedAudit?.actor === a.moderator.userId && issuedAudit?.subjectUserId === teacher.userId,
    'выпуск ссылки в аудите: кто (администратор) и кому (сотрудник)');

  // ─── 4. происхождение сессии (AR-187) ───
  check(linkSession?.clientKind === 'pwa' && linkSession?.ip === '10.1.2.3',
    `сессия хранит вид клиента (${linkSession?.clientKind}) и адрес (${linkSession?.ip})`);
  const dl = await access.createDeviceLinkToken('/journal');
  await access.approveDeviceLink(
    dl.token,
    { userId: teacher.userId, workspaceId: a.workspaceId, roles: ['teacher'], sessionId: linkSession!.id },
    { deviceHint: 'ноутбук', clientKind: 'browser', ip: '10.1.2.4' },
  );
  await drain();
  const dlStatus = await access.deviceLinkStatus(dl.id);
  const dlSession = await sys(() => b.prisma.appSession.findUnique({ where: { token: dlStatus.status === 'used' ? dlStatus.sessionToken! : '' } }));
  check(dlSession?.parentSessionId === linkSession!.id && dlSession?.via === 'device_link',
    'подтверждение сканом записывает родителем сессию телефона — карта устройств покажет, кто кого подключил');
  const activity = await inSchool(a.workspaceId, () => staff.activity(teacher.cardId, 'https://school.example'));
  check(activity.activated && activity.activeSessions === 2 && activity.profileUrl === `https://school.example/staff/${teacher.cardId}`,
    `активность карточки: активирован, живых сессий ${activity.activeSessions}, ссылка на карточку постоянная`);

  // ─── 5. лимит сессий роли (AR-188) ───
  const policy = await inSchool(a.workspaceId, () => admin.setPolicy({ sessionLimits: { teacher: 2 } }, adminActor));
  check(policy.sessionLimits.teacher === 2, 'политика: лимит 2 сессии для роли teacher');
  await inSchool(a.workspaceId, () =>
    refuses(() => admin.setPolicy({ sessionLimits: { teacher: 99 } }, adminActor), 'лимит роли teacher: целое число от 1 до 20 либо пусто', 'лимит вне 1..20'),
  );
  const third = await sessions.issue({ userId: teacher.userId, workspaceId: a.workspaceId, roles: ['teacher'], deviceHint: 'планшет', via: 'password', ip: '10.1.2.5' });
  await drain();
  const teacherSessions = await sys(() => b.prisma.appSession.findMany({ where: { userId: teacher.userId, workspaceId: a.workspaceId } }));
  const live = teacherSessions.filter((s) => s.revokedAt === null);
  const oldest = teacherSessions.find((s) => s.id === linkSession!.id);
  check(live.length === 2 && live.some((s) => s.id === third.id), `третий вход не отклонён: живых сессий ${live.length}, новая среди них`);
  check(oldest?.revokedReason === 'limit', `погашена самая давняя (первая, по ссылке): причина ${oldest?.revokedReason}`);
  const limitEvent = await sys(() =>
    b.prisma.outboxEvent.findFirst({ where: { workspaceId: a.workspaceId, type: SCHOOL_EVENTS.sessionRevoked, payload: { path: ['reason'], equals: 'limit' } } }),
  );
  check(limitEvent?.status === 'PUBLISHED', 'событие отзыва с причиной limit прошло через outbox и опубликовано');
  const limitAudit = await sys(() =>
    b.prisma.auditLog.findFirst({ where: { workspaceId: a.workspaceId, eventId: limitEvent?.id ?? '', action: SCHOOL_EVENTS.sessionRevoked } }),
  );
  check(limitAudit?.subjectUserId === teacher.userId, 'и легло в аудит с субъектом — сотрудником, потерявшим сессию');
  const policyAudit = await sys(() => b.prisma.auditLog.findFirst({ where: { workspaceId: a.workspaceId, action: SCHOOL_EVENTS.policySet } }));
  check(policyAudit?.actor === a.moderator.userId, 'изменение политики в аудите с идентичностью администратора');

  // ─── 6. инцидент-режим (AR-188) ───
  const current = await sessions.issue({ userId: a.moderator.userId, workspaceId: a.workspaceId, roles: ['admin', 'moderator'], deviceHint: 'ноутбук админа', via: 'password' });
  const incident = await inSchool(a.workspaceId, () => admin.revokeAll(current.id, adminActor));
  await drain();
  check(incident.revoked === 2 && incident.users === 1, `инцидент: отозвано ${incident.revoked} сессий у ${incident.users} человека`);
  check((await sessions.read(current.token)) !== null, 'текущая сессия администратора пережила инцидент — он не выбросил себя');
  const afterIncident = await sys(() => b.prisma.appSession.findMany({ where: { userId: teacher.userId, workspaceId: a.workspaceId, revokedReason: 'incident' } }));
  check(afterIncident.length === 2, 'остальные погашены с причиной incident');
  const pol = await inSchool(a.workspaceId, () => admin.policy());
  check(pol.incidentAt !== null && pol.incidentByName === 'Петрова А. В.', `политика помнит инцидент: ${pol.incidentAt} · ${pol.incidentByName}`);
  await inSchool(a.workspaceId, () =>
    refuses(() => admin.revokeSession(afterIncident[0].id, adminActor), 'ACCESS_REVOKED', 'адресный отзыв уже погашенной сессии'),
  );
  const adminSession = await sessions.issue({ userId: teacher.userId, workspaceId: a.workspaceId, roles: ['teacher'], deviceHint: 'снова', via: 'login_code' });
  await inSchool(a.workspaceId, () => admin.revokeSession(adminSession.id, adminActor));
  const revokedByAdmin = await sys(() => b.prisma.appSession.findUnique({ where: { id: adminSession.id } }));
  check(revokedByAdmin?.revokedReason === 'admin', 'адресный отзыв из S-62 — причина admin');

  // ─── 7. реестры: изоляция по школе (G-82) и аудит ───
  const c = await bootstrapSchool(b, 'Школа Б');
  const net = await inSchool(a.workspaceId, () => admin.createNetwork({ ssid: 'School-Staff', audience: 'staff', note: 'учительская' }, adminActor));
  check(net.ssid === 'School-Staff' && net.audience === 'staff', 'сеть заведена в школе А');
  const seenFromB = await inSchool(c.workspaceId, () => admin.listNetworks());
  check(!seenFromB.some((n) => n.id === net.id), 'из школы Б сеть школы А не видна (tenant-guard, G-82)');
  await inSchool(c.workspaceId, () =>
    refuses(() => admin.updateNetwork(net.id, { ssid: 'x', audience: 'staff' }, { ...c.moderator, roles: ['admin'] }), 'сеть не найдена', 'правка чужой сети из школы Б'),
  );
  const updated = await inSchool(a.workspaceId, () => admin.updateNetwork(net.id, { ssid: 'School-Staff-5G', audience: 'staff' }, adminActor));
  check(updated.ssid === 'School-Staff-5G', 'правка сети в своей школе проходит');
  await inSchool(a.workspaceId, () =>
    refuses(() => admin.createNetwork({ ssid: 'Guest', audience: 'everyone' as never }, adminActor), 'аудитория сети: одно из staff, students, guests, devices', 'аудитория вне словаря'),
  );
  const asset = await inSchool(a.workspaceId, () => admin.createAsset({ name: 'Принтер учительской', kind: 'printer', networkId: net.id }, adminActor));
  check(asset.networkId === net.id, 'устройство привязано к сети своей школы');
  await inSchool(c.workspaceId, () =>
    refuses(() => admin.createAsset({ name: 'Чужой', kind: 'printer', networkId: net.id }, { ...c.moderator, roles: ['admin'] }), 'сеть не найдена в реестре школы', 'устройство школы Б не привязывается к сети школы А'),
  );
  await inSchool(a.workspaceId, () => admin.deleteNetwork(net.id, adminActor));
  const orphan = await inSchool(a.workspaceId, () => admin.listAssets());
  check(orphan.find((x) => x.id === asset.id)?.networkId === null, 'удаление сети снимает ссылку у устройства, устройство остаётся');
  await inSchool(a.workspaceId, () => admin.deleteAsset(asset.id, adminActor));
  await drain();
  const registryAudit = await sys(() => b.prisma.auditLog.findMany({ where: { workspaceId: a.workspaceId, action: SCHOOL_EVENTS.registryChanged } }));
  check(registryAudit.length === 5 && registryAudit.every((r) => r.actor === a.moderator.userId),
    `реестр в аудите: ${registryAudit.length} записей (сеть: создана, изменена, удалена; устройство: создано, удалено), все с идентичностью администратора`);
  const registryAuditB = await sys(() => b.prisma.auditLog.count({ where: { workspaceId: c.workspaceId, action: SCHOOL_EVENTS.registryChanged } }));
  check(registryAuditB === 0, 'в аудите школы Б реестровых записей нет');
  const audit = await inSchool(a.workspaceId, () => admin.audit());
  const registryRows = audit.filter((e) => e.action === SCHOOL_EVENTS.registryChanged);
  check(registryRows.length === 5 && registryRows.every((e) => e.actorName === 'Петрова А. В.' && e.actionLabel === 'изменён реестр сети'),
    'аудит школы в кабинете называет действующего и действие словами (AR-116)');

  // ─── 8. обзор ───
  const overview = await inSchool(a.workspaceId, () => admin.overview());
  check(overview.schoolName === 'Школа администратора' && overview.membersTotal === 2 && overview.activatedTotal === 1,
    `обзор: ${overview.schoolName}, людей ${overview.membersTotal}, активировано ${overview.activatedTotal}, живых сессий ${overview.activeSessions}`);

  // ─── 9. чек-лист завуча (AR-193) ───
  const empty = await inSchool(c.workspaceId, () => deputy.cabinet());
  check([...empty.utc, ...empty.kpc].every((i) => !i.done), `пустая школа: все ${empty.utc.length + empty.kpc.length} пунктов не готовы`);
  check(empty.utc.map((i) => i.key).join(',') === 'terms,load,skeleton,dayParams,priorities,generated,confirmed,journal',
    'ключи УТЦ фиксированы и в порядке');
  check(empty.kpc.map((i) => i.key).join(',') === 'classes,students,subjects,bindings,staff,guardians', 'ключи КПЦ фиксированы и в порядке');
  check(empty.kpc.find((i) => i.key === 'guardians')?.detail === 'родители не заведены', 'родители не заведены — названо словами, а не «0 из 0»');
  const ready = await readySchool(b, 'Школа завуча');
  const dep = await inSchool(ready.workspaceId, () => deputy.cabinet());
  const doneKeys = [...dep.utc, ...dep.kpc].filter((i) => i.done).map((i) => i.key);
  for (const k of ['terms', 'load', 'subjects', 'classes', 'bindings', 'generated', 'confirmed']) {
    check(doneKeys.includes(k), `работающая школа: пункт ${k} готов (${[...dep.utc, ...dep.kpc].find((i) => i.key === k)?.detail})`);
  }
  check(dep.coverage.covered === 1 && dep.coverage.total === 1 && dep.load.set === dep.load.total && dep.load.total > 0,
    `сводки: покрытие ${dep.coverage.covered}/${dep.coverage.total}, нормы ${dep.load.set}/${dep.load.total}`);
  check(dep.state === 'ready' && /^\d{4}-\d{2}-\d{2}$/.test(dep.today), `состояние ${dep.state}, сегодня ${dep.today}, уроков сегодня ${dep.lessonsToday}`);

  // ─── 10. «новая сеть» (AR-187) ───
  const roamer = await makeStaff(b, a, ['teacher'], 'Сидоров Олег');
  for (const ip of ['192.168.1.10', '192.168.1.11', '10.0.0.5']) {
    await sessions.issue({ userId: roamer.userId, workspaceId: a.workspaceId, roles: ['teacher'], deviceHint: ip, via: 'password', ip });
  }
  const conns = await inSchool(a.workspaceId, () => admin.connections(roamer.userId));
  check(conns.map((s) => `${s.ip}:${s.newNetwork}`).join(' ') === '10.0.0.5:true 192.168.1.11:false 192.168.1.10:true',
    `журнал подключений (новые первыми): ${conns.map((s) => `${s.ip}${s.newNetwork ? ' — новая сеть' : ''}`).join('; ')}`);
  // Лимит 2 для teacher (п. 5) погасил первую из трёх: карта показывает две
  // живые, но «новая сеть» считается по ИСТОРИИ — 192.168.1.11 не новая,
  // потому что погашенная 192.168.1.10 была из той же /24.
  const map = await inSchool(a.workspaceId, () => admin.devices());
  const node = map.users.find((u) => u.userId === roamer.userId);
  check(node !== undefined && node.sessions.length === 2 && node.sessions.map((s) => `${s.ip}:${s.newNetwork}`).join(' ') === '192.168.1.11:false 10.0.0.5:true',
    `карта устройств: живых сессий ${node?.sessions.length} (лимит роли), признак «новая сеть» выведен из истории, включая погашенную`);
  check(map.users[0]?.roles.some((r) => r !== 'student' && r !== 'parent') === true, 'персонал в карте впереди');

  // ─── 11. чистка журнала подключений (AR-194) ───
  const old = await sys(() =>
    b.prisma.appSession.create({
      data: { token: `old-${Date.now()}`, userId: roamer.userId, workspaceId: a.workspaceId, roles: ['teacher'], via: 'password', expiresAt: new Date(Date.now() + DAY), revokedAt: new Date(Date.now() - 100 * DAY), revokedReason: 'manual' },
    }),
  );
  const recent = await sys(() =>
    b.prisma.appSession.create({
      data: { token: `recent-${Date.now()}`, userId: roamer.userId, workspaceId: a.workspaceId, roles: ['teacher'], via: 'password', expiresAt: new Date(Date.now() + DAY), revokedAt: new Date(Date.now() - 10 * DAY), revokedReason: 'manual' },
    }),
  );
  const cleaned = await sessions.cleanupJournal();
  const oldGone = await sys(() => b.prisma.appSession.findUnique({ where: { id: old.id } }));
  const recentKept = await sys(() => b.prisma.appSession.findUnique({ where: { id: recent.id } }));
  check(cleaned >= 1 && oldGone === null && recentKept !== null,
    `чистка удалила сессию, отозванную 100 дней назад, и оставила отозванную 10 дней назад (удалено ${cleaned})`);

  await b.close();
  report('G-81/G-82 · КАБИНЕТЫ АДМИНИСТРАТОРА И ЗАВУЧА ДОКАЗАНЫ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
