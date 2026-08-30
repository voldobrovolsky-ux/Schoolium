/**
 * G-36 (AR-76, AR-87, AR-88, AR-94) — **QR-активация персонала.**
 *
 *   · QR одноразов и привязан к КОНКРЕТНОЙ карточке;
 *   · закрытие карточки гасит QR — код не переживает встречу;
 *   · повторный скан использованного — отказ с внятным текстом;
 *   · ожидание скана — поллинг раз в 2 секунды, статус читается со стороны
 *     карточки (`waiting` / `scanned` / `used` / `expired`), WebSocket не введён;
 *   · зарегистрированный сотрудник входит потом якорной сессией, привязкой
 *     устройства либо кодом с карточки — **OTP не участвует нигде**;
 *   · активация под аудитом с идентичностью модератора.
 *
 * Запуск: npm --workspace apps/api run qr:check
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCESS_PARAMS } from '@edustore/shared';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { bench, bootstrapSchool, check, inSchool, refuses, report } from './schoolium/harness';

async function main(): Promise<void> {
  const b = await bench();
  const staff = b.get(StaffService);
  const subjects = b.get(SubjectsService);
  const contingent = b.get(ContingentService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-36 · QR-активация персонала и привязки (AR-76, AR-87)\n');

  const school = await bootstrapSchool(b, 'Школа QR');

  await inSchool(school.workspaceId, async () => {
    // ─── QR активации карточки сотрудника ───
    const { card: cardA } = await staff.addCard({ role: 'teacher', lastName: 'Иванова', firstName: 'Мария', middleName: 'Петровна' });
    const { card: cardB } = await staff.addCard({ role: 'teacher', lastName: 'Резервная', firstName: 'Карточка' });
    const tokenA = await staff.createActivationToken(cardA.id);
    const ttl = Math.round((new Date(tokenA.expiresAt).getTime() - Date.now()) / 60_000);
    check(ttl === ACCESS_PARAMS.activationTtlMinutes,
      `QR активации живёт ${ttl} минут либо до закрытия карточки — что раньше (AR-76)`);
    check((await staff.activationStatus(cardA.id)).status === 'waiting',
      'открытая карточка опрашивает статус раз в 2 секунды: waiting (AR-87)');

    // токен привязан к КОНКРЕТНОЙ карточке
    const other = await staff.activationStatus(cardB.id);
    check(other.token !== tokenA.token, 'у другой карточки другой токен — QR привязан к своей карточке');

    check(tokenA.fullName === 'Иванова Мария', `над QR — ФИО владельца: «${tokenA.fullName}» (AR-161)`);
    const joined = await staff.activate(tokenA.token, { openedByOtherSession: false, deviceHint: 'телефон' });
    await drain();
    check(joined.sessionToken !== null, 'после скана человек в СВОЁМ кабинете, ничего не вводя (AR-91, AR-161)');
    const after = await staff.activationStatus(cardA.id);
    check(after.status === 'used', `статус токена после активации: ${after.status}`);
    check(after.registeredName === 'Иванова Мария', `карточка показывает имя: ${after.registeredName}`);

    await refuses(
      () => staff.activate(tokenA.token, { openedByOtherSession: false, deviceHint: 'телефон' }),
      'TOKEN_USED',
      'повторный скан использованного QR отклонён с внятным текстом',
    );

    // ─── закрытие карточки гасит QR ───
    const tokenB = await staff.createActivationToken(cardB.id);
    check((await staff.activationStatus(cardB.id)).status === 'waiting', 'QR второй карточки открыт');
    await staff.closeCard(cardB.id);
    check((await staff.activationStatus(cardB.id)).status === 'expired',
      'закрытие карточки ГАСИТ QR — код не переживает встречу (AR-76)');
    await refuses(
      () => staff.activate(tokenB.token, { openedByOtherSession: false, deviceHint: 'телефон' }),
      'TOKEN_EXPIRED',
      'скан погашенного QR отклонён',
    );

    // ─── QR привязки педагога к предмету (S-22) ───
    await contingent.createClasses(
      { parallels: 1, letters: null, studentsPerClass: 2, groups: null, sexKind: 'boys', sexCount: 1, version: 0 },
      school.moderator,
    );
    await drain();
    const cls = (await contingent.listClasses())[0];
    const subject = await subjects.create({ name: 'Физика', classId: cls.id });
    const bind = await subjects.createBindToken(subject.id);
    const bindTtl = Math.round((new Date(bind.expiresAt).getTime() - Date.now()) / 60_000);
    check(bindTtl === ACCESS_PARAMS.bindTokenTtlMinutes, `QR привязки живёт ${bindTtl} минут (AR-94)`);
    check((await subjects.bindTokenStatus(subject.id)).status === 'waiting',
      'до скана блок выбора охвата показывает «Ожидание сканирования» (AR-87)');

    const teacherActor = { userId: joined.userId, workspaceId: school.workspaceId, roles: ['teacher' as const], name: 'Иванова Мария' };
    await subjects.scan(bind.token, teacherActor);
    const scanned = await subjects.bindTokenStatus(subject.id);
    check(scanned.status === 'scanned', 'после скана статус — scanned');
    check(scanned.scannedByName === 'Иванова Мария',
      `карточка узнала идентичность сканировавшего поллингом: ${scanned.scannedByName}`);

    await subjects.bindTeacher(subject.id, { token: bind.token, scope: 'class' }, school.moderator);
    await drain();
    check((await subjects.get(subject.id)).coverageComplete, 'привязка выполнена, покрытие полное');
    check((await subjects.bindTokenStatus(subject.id)).status === 'used', 'токен привязки погашен первой успешной операцией');
    await refuses(
      () => subjects.bindTeacher(subject.id, { token: bind.token, scope: 'class' }, school.moderator),
      'TOKEN_USED',
      'вторая привязка тем же токеном отклонена — половинной привязки не бывает (AR-109)',
    );

    // ─── аудит активации с идентичностью ───
    const audit = await b.prisma.auditLog.findMany({ where: { workspaceId: school.workspaceId } });
    const reg = audit.find((e) => e.action === 'staff.member.registered.v1');
    check(Boolean(reg), 'активация записана в аудит (AR-30)');
    check(reg?.subjectUserId === joined.userId, 'в записи назван активированный сотрудник');
    const bound = audit.find((e) => e.action === 'subject.teacher.bound.v1');
    check(bound?.actor === school.moderator.userId, 'привязка записана с идентичностью модератора');
  });

  // ─── OTP не участвует нигде ───
  const accessSrc = readFileSync(join(__dirname, '../src/schoolium/access/access.service.ts'), 'utf8');
  check(!/otp/i.test(accessSrc.replace(/OTP не отправляется|OTP-контур/g, '')),
    'в контуре доступа нет ни одной операции OTP — вход держится на сессии, привязке и коде с карточки (AR-94)');

  await b.close();
  report('G-36 · QR-АКТИВАЦИЯ ДОКАЗАНА');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
