/**
 * G-44 (AR-91, AR-92, AR-93, AR-94) — **маршрут входа доказан перечислением.**
 *
 * Решётка «устройство × якорная сессия × камера × присутствие модератора»
 * заполнена целиком: у каждой клетки есть путь либо НАЗВАННАЯ причина его
 * отсутствия. Тупика «входа нет и никто не поможет» не существует по построению.
 *
 *   · регистрация со своего устройства выдаёт сессию, с устройства модератора —
 *     не выдаёт: чужое устройство не становится его кабинетом;
 *   · токен привязки одноразов (TTL 3 мин), сессия нового устройства наследует
 *     школу и роли сканирующего;
 *   · код входа одноразов (5 мин, шесть цифр);
 *   · деактивация отзывает ВСЕ сессии немедленно, адресное завершение — ровно одну;
 *   · bootstrap-ссылка одноразова и перевыпускается — школа не запирается.
 *
 * Запуск: npm --workspace apps/api run login:check
 */
import { ACCESS_PARAMS, safeNext } from '@edustore/shared';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { SchoolSessionService } from '../src/common/auth/school-session.service';
import { AccessService } from '../src/schoolium/access/access.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { bench, bootstrapSchool, check, inSchool, report } from './schoolium/harness';

async function main(): Promise<void> {
  const b = await bench();
  const access = b.get(AccessService);
  const staff = b.get(StaffService);
  const sessions = b.get(SchoolSessionService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());
  const sys = <T>(fn: () => Promise<T>) => TenantContext.runAsSystem(fn);

  console.log('G-44 · маршрут входа: решётка заполнена целиком (AR-94)\n');

  const school = await bootstrapSchool(b, 'Школа входа');

  // ─── клетка 1: регистрация со СВОЕГО устройства → сессия 90 дней ───
  const own = await inSchool(school.workspaceId, async () => {
    const { card } = await staff.addCard({ role: 'teacher', lastName: 'Иванова', firstName: 'Мария',
      username: `maria_${Math.floor(Math.random() * 10_000_000)}` });
    const t = await staff.createActivationToken(card.id);
    return staff.activate(t.token, { openedByOtherSession: false, deviceHint: 'телефон сотрудника' });
  });
  await drain();
  check(own.sessionToken !== null, 'своё устройство: активация одним сканом выдаёт сессию — телефон становится якорным (AR-91, AR-161)');

  // ─── клетка 2: регистрацию заполнили с устройства МОДЕРАТОРА → сессии нет ───
  const foreign = await inSchool(school.workspaceId, async () => {
    const { card } = await staff.addCard({ role: 'teacher', lastName: 'Сидоров', firstName: 'Олег',
      username: `oleg_${Math.floor(Math.random() * 10_000_000)}` });
    const t = await staff.createActivationToken(card.id);
    return staff.activate(t.token, { openedByOtherSession: true, deviceHint: 'ноутбук модератора' });
  });
  await drain();
  check(foreign.sessionToken === null,
    'устройство модератора: сессия человеку НЕ создаётся — чужое устройство не становится его кабинетом (AR-91)');

  // ─── клетка 3: новое устройство при живом телефоне → привязка по QR ───
  const link = await access.createDeviceLinkToken('/journal');
  const ttlMin = Math.round((link.expiresAt.getTime() - Date.now()) / 60_000);
  check(ttlMin === ACCESS_PARAMS.deviceLinkTtlMinutes, `токен привязки живёт ${ttlMin} мин — QR на экране входа не залёживается`);
  check((await access.deviceLinkStatus(link.id)).status === 'waiting', 'страница входа опрашивает статус: waiting');

  const scanner = { userId: own.userId, workspaceId: school.workspaceId, roles: ['teacher'] };
  const approved = await access.approveDeviceLink(link.token, scanner, 'ноутбук');
  await drain();
  check(approved.ok === true, 'скан якорным устройством подтверждает привязку');
  check(approved.nextPath === '/journal', 'после входа возврат на next — путь валидирован как относительный (AR-95)');
  const status = await access.deviceLinkStatus(link.id);
  check(status.status === 'used' && Boolean(status.sessionToken), 'страница забрала сессию поллингом');
  const linked = await sessions.read(status.sessionToken!);
  check(linked?.workspaceId === school.workspaceId && linked?.roles?.includes('teacher') === true,
    'новое устройство получило сессию ТОЙ ЖЕ школы и ТЕХ ЖЕ ролей, что у сканирующего');

  let reuse = 'нет отказа';
  try {
    await access.approveDeviceLink(link.token, scanner, 'второй ноутбук');
  } catch (e) {
    reuse = (e as { response?: { code?: string } }).response?.code ?? 'ошибка';
  }
  check(reuse === 'TOKEN_USED', `повторный скан токена привязки → ${reuse}: токен одноразов`);

  // ─── клетка 4: якоря нет, модератор рядом → код входа ───
  const code = await inSchool(school.workspaceId, async () => {
    const card = await b.prisma.staffCard.findFirst({ where: { userId: foreign.userId } });
    return staff.issueLoginCode(card!.id);
  });
  check(/^\d{6}$/.test(code.code), `код входа — шесть цифр: ${code.code.replace(/\d/g, '•')}`);
  const codeTtl = Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 60_000);
  check(codeTtl === ACCESS_PARAMS.loginCodeTtlMinutes, `код живёт ${codeTtl} минут (AR-92)`);
  const byCode = await access.verifyLoginCode(code.code, 'школьный компьютер');
  await drain();
  check(byCode.session.token.length > 0, 'вход по коду выдал сессию — восстановление доступа без якоря работает');
  let reuseCode = 'нет отказа';
  try {
    await access.verifyLoginCode(code.code, 'ещё раз');
  } catch (e) {
    reuseCode = (e as { response?: { code?: string } }).response?.code ?? 'ошибка';
  }
  check(reuseCode === 'LOGIN_CODE_INVALID', `повторный ввод того же кода → ${reuseCode}: код одноразов`);

  // ─── клетка 5: деактивация закрывает ВСЕ маршруты немедленно ───
  const foreignCard = await sys(() => b.prisma.staffCard.findFirst({ where: { userId: foreign.userId } }));
  await inSchool(school.workspaceId, () => staff.deactivate(foreignCard!.id, school.moderator));
  await drain();
  check((await sessions.read(byCode.session.token)) === null,
    'деактивация отозвала живую сессию немедленно — доступ уволенного не живёт 90 дней (AR-92)');
  let revoked = 'нет отказа';
  try {
    const c2 = await inSchool(school.workspaceId, () => staff.issueLoginCode(foreignCard!.id));
    await access.verifyLoginCode(c2.code, 'попытка после деактивации');
  } catch (e) {
    revoked = (e as { response?: { code?: string } }).response?.code ?? 'ошибка';
  }
  check(revoked === 'ACCESS_REVOKED', `деактивированному новый маршрут не выдаётся → ${revoked}`);

  // ─── клетка 6: адресное завершение убивает ровно одну сессию ───
  const s1 = await sessions.issue({ userId: own.userId, workspaceId: school.workspaceId, roles: ['teacher'], deviceHint: 'телефон' });
  const s2 = await sessions.issue({ userId: own.userId, workspaceId: school.workspaceId, roles: ['teacher'], deviceHint: 'планшет' });
  await sessions.revoke(s1.id, 'manual');
  check((await sessions.read(s1.token)) === null && (await sessions.read(s2.token)) !== null,
    'завершение из настроек убивает РОВНО одну сессию — остальные устройства живут (S-80)');

  // ─── клетка 7: первый модератор и перевыпуск ссылки ───
  const bootstrapLink = await sys(() =>
    b.prisma.bootstrapLink.create({
      data: {
        workspaceId: school.workspaceId,
        userId: school.moderator.userId,
        token: `boot-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + ACCESS_PARAMS.bootstrapLinkTtlHours * 3600_000),
      },
    }),
  );
  const bootSession = await access.useBootstrapLink(bootstrapLink.token, 'ноутбук директора');
  await drain();
  check(bootSession.token.length > 0, 'первый модератор входит по одноразовой ссылке платформы (AR-93)');
  let reuseBoot = 'нет отказа';
  try {
    await access.useBootstrapLink(bootstrapLink.token, 'ещё раз');
  } catch (e) {
    reuseBoot = (e as { response?: { code?: string } }).response?.code ?? 'ошибка';
  }
  check(reuseBoot === 'TOKEN_USED', `повторное использование ссылки → ${reuseBoot}: она одноразова`);
  const relink = await sys(() =>
    b.prisma.bootstrapLink.create({
      data: {
        workspaceId: school.workspaceId,
        userId: school.moderator.userId,
        token: `boot-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + ACCESS_PARAMS.bootstrapLinkTtlHours * 3600_000),
      },
    }),
  );
  const again = await access.useBootstrapLink(relink.token, 'новый телефон директора');
  check(again.token.length > 0,
    'та же операция перевыпускает ссылку — единственный модератор без единой сессии не запирает школу навсегда (AR-93)');

  // ─── клетка 8: якоря нет и модератора нет — вход невозможен, и это НАЗВАНО ───
  const help = readHelpText();
  check(help.includes('модератор'),
    `тупик назван честно: «${help}» — не «попробуйте позже»`);

  // ─── `next` валидируется как относительный путь своего origin (AR-95) ───
  check(safeNext('/journal', '/classes') === '/journal', 'относительный путь принимается');
  check(safeNext('//evil.example', '/classes') === '/classes', 'протокол-относительный «//» отклонён');
  check(safeNext('https://evil.example', '/classes') === '/classes', 'абсолютный URL отклонён — открытого редиректа нет');

  await b.close();
  report('G-44 · МАРШРУТ ВХОДА ДОКАЗАН');
}

/** Текст тупика — из экранного реестра, а не выдуманный проверкой. */
function readHelpText(): string {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../../specs/school-onboarding/70-screens.md'),
    'utf8',
  ) as string;
  const m = src.match(/«(Первый раз здесь\?[^»]*)»/);
  return m ? m[1] : '';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
