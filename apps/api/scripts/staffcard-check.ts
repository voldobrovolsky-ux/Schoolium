/**
 * G-87 (AR-203, AR-204) — **карточка сотрудника: учётка, пароль, ссылка входа
 * с параметрами — перечислением.**
 *
 *   · три маршрута карточки (`PUT /staff/:id/account`, `POST /staff/:id/password`,
 *     `POST /staff/:id/login-link`) гейчены `staff.manage`: модератор проходит
 *     (200), педагог — нет (403); ссылку больше не держит `school.admin` (AR-204
 *     вытесняет AR-189);
 *   · правка ФИО и логина: `displayName` пересобран, чужой логин — `USERNAME_TAKEN`
 *     (уникальность на всю инсталляцию, AR-154), кривой — `USERNAME_INVALID`,
 *     свой же логин занятостью не считается;
 *   · пароль: короче 8 знаков — `PASSWORD_TOO_SHORT`; заданный открывает сессию
 *     паролем, прежний перестаёт работать; перевыпуск и пустое поле — генерация
 *     (`generated: true`); в событие пароль не едет (AR-156);
 *   · ссылка на 24 ч с одним открытием: первое даёт сессию, второе —
 *     `LINK_EXHAUSTED` («1 из 1»); без лимита — второе открытие даёт вторую
 *     сессию, счётчик растёт; срок и лимит вне меню отклоняются; событие несёт
 *     `ttlHours`/`maxUses`;
 *   · события учётки и пароля лежат в аудите с идентичностью выпускающего и
 *     субъектом — сотрудником.
 *
 * Запуск: npm --workspace apps/api run staffcard:check
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ACCESS_PARAMS } from '@edustore/shared';
import { REQUIRE_PERMISSION } from '../src/common/authz/require-permission.decorator';
import { AuthzService } from '../src/common/authz/authz.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { AccessService } from '../src/schoolium/access/access.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { SCHOOL_EVENTS } from '../src/schoolium/schoolium.contract';
import type { SchoolActor } from '../src/schoolium/actor';
import { bench, bootstrapSchool, check, inSchool, refuses, report } from './schoolium/harness';

const HOUR = 3600_000;
const ORIGIN = 'https://school.example';
const rnd = () => Math.floor(Math.random() * 10_000_000);

/** Ошибка как её увидит клиент: код и текст `SchoolError` либо текст Nest-исключения. */
async function fails(fn: () => Promise<unknown>): Promise<{ code: string | null; message: string }> {
  try {
    await fn();
    return { code: null, message: 'нет отказа' };
  } catch (e) {
    const body = (e as { response?: { code?: string; message?: string } }).response;
    return { code: body?.code ?? null, message: body?.message ?? (e as Error).message };
  }
}

async function main(): Promise<void> {
  const b = await bench();
  const authz = b.get(AuthzService);
  const access = b.get(AccessService);
  const staff = b.get(StaffService);
  const sys = <T>(fn: () => Promise<T>) => TenantContext.runAsSystem(fn);
  const drain = () => sys(() => b.outbox.drain());

  console.log('G-87 · карточка сотрудника: учётка, пароль, ссылка с параметрами (AR-203, AR-204)\n');

  // ─── 1. право маршрутов карточки: staff.manage — модератор 200, педагог 403 ───
  const container = b.app.get(ModulesContainer);
  const routes: { route: string; method: RequestMethod; perm: string | string[] | undefined }[] = [];
  for (const m of container.values()) {
    for (const [, w] of m.controllers) {
      const ctor = w.metatype as (new () => unknown) | undefined;
      if (!ctor || ctor.name !== 'StaffController') continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, ctor) ?? '');
      const proto = ctor.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const h = proto[name] as object;
        if (typeof h !== 'function') continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, h);
        if (method === undefined) continue;
        const path = String(Reflect.getMetadata(PATH_METADATA, h) ?? '');
        routes.push({ route: `/${base}/${path}`.replace(/\/+/g, '/'), method, perm: Reflect.getMetadata(REQUIRE_PERMISSION, h) });
      }
    }
  }
  const find = (method: RequestMethod, route: string) => routes.find((r) => r.method === method && r.route === route);
  const accountRoute = find(RequestMethod.PUT, '/v1/staff/:id/account');
  const passwordRoute = find(RequestMethod.POST, '/v1/staff/:id/password');
  const linkRoute = find(RequestMethod.POST, '/v1/staff/:id/login-link');
  check(accountRoute?.perm === 'staff.manage', `PUT /v1/staff/:id/account за staff.manage (§11 строка 51): ${accountRoute?.perm ?? 'маршрута нет'}`);
  check(passwordRoute?.perm === 'staff.manage', `POST /v1/staff/:id/password за staff.manage (§11 строка 52): ${passwordRoute?.perm ?? 'маршрута нет'}`);
  check(linkRoute?.perm === 'staff.manage', `POST /v1/staff/:id/login-link за staff.manage, а не school.admin (§11 строка 39, AR-204): ${linkRoute?.perm ?? 'маршрута нет'}`);
  const modAcc = await authz.resolveForRoles(['moderator']);
  const adminAcc = await authz.resolveForRoles(['admin']);
  const teacherAcc = await authz.resolveForRoles(['teacher']);
  check(modAcc.permissions.includes('staff.manage') && adminAcc.permissions.includes('staff.manage'),
    'модератор и администратор держат staff.manage — ссылку, учётку и пароль с карточки выпускают оба (200)');
  check(!teacherAcc.permissions.includes('staff.manage') && !teacherAcc.permissions.includes('school.admin'),
    'педагог staff.manage не держит — ему маршруты карточки закрыты (403 по праву)');

  // ─── 2. учётка: ФИО и логин ───
  const school = await bootstrapSchool(b, 'Школа карточки');
  // действующий — модератор (не администратор): ссылку и учётку с 1.5.0 правит и он
  const moderator: SchoolActor = { ...school.moderator, roles: ['moderator'] };
  const uname = `petrova_${rnd()}`;
  const taken = `taken_${rnd()}`;
  await inSchool(school.workspaceId, async () => {
    const { card, credentials } = await staff.addCard({ role: 'teacher', lastName: 'Петрова', firstName: 'Мария', username: uname });
    await staff.addCard({ role: 'teacher', lastName: 'Занятова', firstName: 'Ольга', username: taken });
    const initialPassword = credentials.password;

    const renamed = `maria_${rnd()}`;
    const upd = await staff.updateAccount(card.id, { lastName: 'Петрова-Иванова', firstName: 'Мария', middleName: 'Сергеевна', username: renamed }, moderator);
    check(upd.lastName === 'Петрова-Иванова' && upd.middleName === 'Сергеевна' && upd.username === renamed,
      `ФИО и логин изменены с карточки: ${upd.lastName} ${upd.firstName} ${upd.middleName} @${upd.username} (AR-203)`);
    check(upd.name === 'Петрова-Иванова Мария', `displayName пересобран тем же правилом, что при заведении: «${upd.name}»`);
    const gone = await sys(() => b.prisma.user.findUnique({ where: { username: uname } }));
    check(gone === null, 'прежний логин освободился — учётка одна, логинов у неё не два');

    await refuses(() => staff.updateAccount(card.id, { lastName: 'Петрова-Иванова', firstName: 'Мария', username: taken }, moderator),
      'USERNAME_TAKEN', 'логин другой учётки — USERNAME_TAKEN (уникальность на всю инсталляцию, AR-154)');
    await refuses(() => staff.updateAccount(card.id, { lastName: 'Петрова-Иванова', firstName: 'Мария', username: 'Bad Name!' }, moderator),
      'USERNAME_INVALID', 'логин с пробелом и заглавными — USERNAME_INVALID');
    const same = await staff.updateAccount(card.id, { lastName: 'Петрова-Иванова', firstName: 'Мария', middleName: null, username: renamed }, moderator);
    check(same.username === renamed && same.middleName === null, 'свой же логин занятостью не считается — правка одного отчества проходит');
    await drain();
    const accountEvents = await sys(() => b.prisma.outboxEvent.findMany({ where: { workspaceId: school.workspaceId, type: SCHOOL_EVENTS.accountUpdated } }));
    const first = accountEvents.find((e) => (e.payload as { fields?: string[] }).fields?.includes('username'));
    check(accountEvents.length === 2 && first !== undefined && (first.payload as { updatedBy: string }).updatedBy === moderator.userId,
      `событий staff.account.updated.v1: ${accountEvents.length}, первое несёт поля ${((first?.payload as { fields?: string[] })?.fields ?? []).join(', ')} и кто правил — сами значения в событие не едут`);

    // ─── 3. пароль ───
    await refuses(() => staff.setPassword(card.id, { password: 'short' }, moderator), 'PASSWORD_TOO_SHORT',
      'пароль короче 8 знаков отклонён (M-32, ACCESS_PARAMS.passwordMinLength)');
    const set = await staff.setPassword(card.id, { password: 'strongpass1' }, moderator);
    check(set.username === renamed && set.password === 'strongpass1', 'заданный пароль вернулся один раз вместе с логином (CredentialsDto)');
    const byNew = await access.loginWithPassword(renamed, 'strongpass1', 'ноутбук');
    check(byNew.session.token.length > 0, 'вход новым паролем открывает сессию (S-05′)');
    await refuses(() => access.loginWithPassword(renamed, initialPassword, 'ноутбук'), 'LOGIN_FAILED',
      'прежний (сгенерированный при заведении) пароль больше не работает');
    const reissued = await staff.regenerateCredentials(card.id, moderator);
    check(reissued.password.length >= ACCESS_PARAMS.passwordMinLength && reissued.password !== 'strongpass1',
      `перевыпуск сгенерировал новый пароль (${reissued.password.length} знаков), показан один раз`);
    const byReissued = await access.loginWithPassword(renamed, reissued.password, 'телефон');
    check(byReissued.session.token.length > 0, 'вход перевыпущенным паролем проходит');
    await refuses(() => access.loginWithPassword(renamed, 'strongpass1', 'ноутбук'), 'LOGIN_FAILED', 'заданный ранее пароль после перевыпуска не работает');
    const blank = await staff.setPassword(card.id, {}, moderator);
    check(blank.password.length >= ACCESS_PARAMS.passwordMinLength, 'пустое поле M-32 — пароль сгенерирован сервером');
    await drain();
    const pwEvents = await sys(() => b.prisma.outboxEvent.findMany({ where: { workspaceId: school.workspaceId, type: SCHOOL_EVENTS.passwordSet }, orderBy: { createdAt: 'asc' } }));
    const flags = pwEvents.map((e) => (e.payload as { generated: boolean }).generated);
    check(flags.join(',') === 'false,true,true', `события staff.password.set.v1: generated = ${flags.join(', ')} (задан, перевыпуск, пустое поле)`);
    check(pwEvents.every((e) => !JSON.stringify(e.payload).includes('strongpass1') && !JSON.stringify(e.payload).includes(reissued.password)),
      'ни в одном событии пароля нет открытого текста (AR-156)');
    const hash = await sys(() => b.prisma.user.findUnique({ where: { id: card.userId! } }));
    check(Boolean(hash?.passwordHash?.startsWith('$2')) && hash?.passwordHash !== blank.password, 'в базе — только bcrypt-хэш, открытого пароля нет');

    // ─── 4. ссылка входа с параметрами (AR-204) ───
    const once = await staff.issueLoginLink(card.id, moderator, ORIGIN, { ttlHours: 24, maxUses: 1 });
    const onceTtl = Math.round((new Date(once.expiresAt).getTime() - Date.now()) / HOUR);
    check(once.url === `${ORIGIN}/bootstrap/${once.token}` && onceTtl === 24 && once.maxUses === 1 && once.useCount === 0,
      `ссылка на ${onceTtl} ч с одним открытием: maxUses ${once.maxUses}, useCount ${once.useCount}, адрес от публичного origin`);
    const opened = await access.useBootstrapLink(once.token, 'телефон сотрудника');
    check(opened.session.token.length > 0, 'первое открытие даёт сессию');
    const onceRow = await sys(() => b.prisma.bootstrapLink.findUnique({ where: { token: once.token } }));
    check(onceRow?.useCount === 1 && onceRow?.usedAt !== null, `счётчик открытий ${onceRow?.useCount}, usedAt помнит первое открытие`);
    const exhausted = await fails(() => access.useBootstrapLink(once.token, 'ноутбук сотрудника'));
    check(exhausted.code === 'LINK_EXHAUSTED' && exhausted.message === 'Ссылка использована 1 из 1 раз — попросите выпустить новую',
      `второе открытие → ${exhausted.code}: «${exhausted.message}»`);
    const sessionsAfter = await sys(() => b.prisma.appSession.count({ where: { userId: card.userId!, via: 'login_link', revokedAt: null } }));
    check(sessionsAfter === 1, `сессий канала login_link у сотрудника: ${sessionsAfter} — исчерпанная ссылка второй не дала`);

    const unlimited = await staff.issueLoginLink(card.id, moderator, ORIGIN);
    const unlTtl = Math.round((new Date(unlimited.expiresAt).getTime() - Date.now()) / HOUR);
    check(unlTtl === ACCESS_PARAMS.loginLinkTtlHours && unlimited.maxUses === null,
      `пустое тело — дефолты: ${unlTtl} ч, без лимита открытий (поведение AR-195 сохранено)`);
    const u1 = await access.useBootstrapLink(unlimited.token, 'телефон');
    const u2 = await access.useBootstrapLink(unlimited.token, 'ноутбук');
    check(u1.session.token !== u2.session.token, 'без лимита второе открытие — вторая сессия');
    const unlRow = await sys(() => b.prisma.bootstrapLink.findUnique({ where: { token: unlimited.token } }));
    check(unlRow?.useCount === 2 && unlRow?.maxUses === null, `счётчик открытий растёт и без лимита: ${unlRow?.useCount}`);

    const week = await staff.issueLoginLink(card.id, moderator, ORIGIN, { ttlHours: 168, maxUses: 10 });
    const weekTtl = Math.round((new Date(week.expiresAt).getTime() - Date.now()) / HOUR);
    check(weekTtl === 168 && week.maxUses === 10, `ссылка на 7 дней с 10 открытиями: ${weekTtl} ч, maxUses ${week.maxUses}`);
    const badTtl = await fails(() => staff.issueLoginLink(card.id, moderator, ORIGIN, { ttlHours: 12 as never }));
    check(badTtl.message === 'срок ссылки: одно из 24, 48, 168 часов', `срок вне меню отклонён: «${badTtl.message}»`);
    const badUses = await fails(() => staff.issueLoginLink(card.id, moderator, ORIGIN, { maxUses: 5 }));
    check(badUses.message === 'число открытий ссылки: одно из 1, 3, 10, без лимита', `число открытий вне меню отклонено: «${badUses.message}»`);
    await drain();
    const issued = await sys(() => b.prisma.outboxEvent.findMany({ where: { workspaceId: school.workspaceId, type: SCHOOL_EVENTS.loginLinkIssued }, orderBy: { createdAt: 'asc' } }));
    const p0 = issued[0]?.payload as { ttlHours: number; maxUses: number | null; issuedBy: string };
    const p1 = issued[1]?.payload as { ttlHours: number; maxUses: number | null };
    check(issued.length === 3 && p0.ttlHours === 24 && p0.maxUses === 1 && p1.ttlHours === 48 && p1.maxUses === null && p0.issuedBy === moderator.userId,
      `событие выпуска несёт срок и лимит: ${issued.map((e) => `${(e.payload as { ttlHours: number }).ttlHours}ч/${(e.payload as { maxUses: number | null }).maxUses ?? '∞'}`).join(', ')}; выпустил модератор`);

    // ─── 5. аудит ───
    const audit = await sys(() => b.prisma.auditLog.findMany({ where: { workspaceId: school.workspaceId, action: { in: [SCHOOL_EVENTS.accountUpdated, SCHOOL_EVENTS.passwordSet] } } }));
    const acc = audit.filter((r) => r.action === SCHOOL_EVENTS.accountUpdated);
    const pw = audit.filter((r) => r.action === SCHOOL_EVENTS.passwordSet);
    check(acc.length === 2 && acc.every((r) => r.actor === moderator.userId && r.subjectUserId === card.userId),
      `учётка в аудите: ${acc.length} записи, кто (модератор) и о ком (сотрудник)`);
    check(pw.length === 3 && pw.every((r) => r.actor === moderator.userId && r.subjectUserId === card.userId),
      `пароль в аудите: ${pw.length} записи с идентичностью выпускающего и субъектом`);
    // ── AR-211: учётка администратора закрыта от модератора ──
    // Пароль и ссылка входа — выдача ДОСТУПА: с `staff.manage` модератор задал бы
    // администратору пароль и вошёл бы под ним, и разделение кабинетов (AR-186)
    // держалось бы на его добросовестности.
    const { card: adminCard } = await staff.addCard({
      role: 'teacher', lastName: 'Директоров', firstName: 'Пётр', username: `admin_${rnd()}`,
    });
    await staff.addRole(adminCard.id, 'admin', moderator);
    const asAdmin: SchoolActor = { ...school.moderator, roles: ['admin'] };

    await refuses(() => staff.setPassword(adminCard.id, { password: 'podmena123' }, moderator),
      'ADMIN_ACCOUNT_LOCKED', 'модератор не задаёт пароль администратору школы (AR-211)');
    await refuses(() => staff.regenerateCredentials(adminCard.id, moderator),
      'ADMIN_ACCOUNT_LOCKED', 'модератор не перевыпускает пароль администратора');
    await refuses(() => staff.issueLoginLink(adminCard.id, moderator, 'http://localhost:5173', {}),
      'ADMIN_ACCOUNT_LOCKED', 'модератор не выпускает ссылку входа на карточку администратора');
    await refuses(() => staff.updateAccount(adminCard.id, { lastName: 'Директоров', firstName: 'Пётр', username: `taken_${rnd()}` }, moderator),
      'ADMIN_ACCOUNT_LOCKED', 'модератор не меняет логин администратора');

    const adminPw = await staff.setPassword(adminCard.id, {}, asAdmin);
    check(adminPw.password.length >= 8, `администратор свою учётку ведёт сам: пароль выпущен (${adminPw.username})`);
    const adminLink = await staff.issueLoginLink(adminCard.id, asAdmin, 'http://localhost:5173', {});
    check(Boolean(adminLink.token), 'администратор выпускает ссылку входа на карточку администратора');

    // Ограничение стоит только на контуре доступа: кадровый учёт у модератора прежний (AR-88).
    const roled = await staff.addRole(adminCard.id, 'deputy_upbringing', moderator);
    check(roled.roles.includes('deputy_upbringing'), 'роли администратора модератор по-прежнему ведёт (AR-88 не сужен)');
    const teacherPw = await staff.setPassword(card.id, {}, moderator);
    check(teacherPw.password.length >= 8, 'учётка обычного сотрудника модератору по-прежнему открыта');
  });

  await b.close();
  report('G-87 · КАРТОЧКА СОТРУДНИКА ДОКАЗАНА');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
