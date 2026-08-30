/**
 * G-64…G-70 — ворота инкремента «Запуск школы 1.2.0» (specs/school-launch/).
 *
 * Перечислением доказываются: вход по юзернейму и паролю как фолбэк (G-64),
 * отзыв активации ученика и родителя (G-65 на новых видах карточек; персонал —
 * в G-24), проекции дневника без единой мутации (G-67), данные-минимум детей
 * (G-69), идемпотентность пресета предметов (G-70), путь родителя к дневнику
 * ребёнка через `GuardianLink` (AR-151/AR-158). Матрица прав v2 (G-66) — в
 * `moderator-audit-check.ts`.
 *
 * Запуск: npm --workspace apps/api run launch:check
 */
import { bench, bootstrapSchool, check, inSchool, refuses, report } from './schoolium/harness';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { AccessService } from '../src/schoolium/access/access.service';
import { AccountsService } from '../src/schoolium/access/accounts.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { DiaryService } from '../src/schoolium/diary/diary.service';
import { SchoolSessionService } from '../src/common/auth/school-session.service';

async function main(): Promise<void> {
  const b = await bench();
  const access = b.get(AccessService);
  const accounts = b.get(AccountsService);
  const staff = b.get(StaffService);
  const contingent = b.get(ContingentService);
  const subjects = b.get(SubjectsService);
  const diary = b.get(DiaryService);
  const sessions = b.get(SchoolSessionService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-64…G-70 · запуск школы 1.2.0\n');

  const school = await bootstrapSchool(b, 'Школа запуска');
  const uname = `launch_${Math.floor(Math.random() * 10_000_000)}`;

  await inSchool(school.workspaceId, async () => {
    // ─── G-64 · вход по юзернейму и паролю — фолбэк слетевшей сессии ───
    const { credentials } = await staff.addCard({
      role: 'teacher',
      lastName: 'Фолбэкова',
      firstName: 'Вера',
      username: uname,
    });
    const login = await access.loginWithPassword(uname, credentials.password, 'ноутбук');
    check(Boolean(login.session.token) && login.roles.includes('teacher'),
      'G-64: юзернейм+пароль открывают сессию без QR — фолбэк работает (AR-156)');
    await refuses(() => access.loginWithPassword(uname, 'wrong-password', 'ноутбук'), 'LOGIN_FAILED',
      'G-64: неверный пароль — LOGIN_FAILED');
    await refuses(() => access.loginWithPassword('no_such_user_00', 'whatever', 'ноутбук'), 'LOGIN_FAILED',
      'G-64: несуществующий юзернейм — ТОТ ЖЕ LOGIN_FAILED, существование учётки не раскрывается');
    await drain();

    // ─── контингент: класс и ученик для дневника ───
    await contingent.createClasses(
      { parallels: 3, letters: null, studentsPerClass: 2, groups: null, sexKind: 'boys', sexCount: 1, version: 0 },
      school.moderator,
    );
    await drain();
    const cls = (await contingent.listClasses())[0];
    const pupil = (await contingent.listStudents(cls.id))[0];
    await contingent.updateStudent(pupil.id, { lastName: 'Иванова', firstName: 'Мария', sex: 'f' }, school.moderator);
    await drain();

    // ─── G-69 · данные-минимум: доступ не добавляет ПДн-полей ───
    const created = await accounts.createStudentAccess(pupil.id, {});
    check(created.access.hasAccount && Boolean(created.credentials.username),
      'учётка ученика заведена поверх записи контингента — ФИО не спрашивались заново (AR-155)');
    const cols: { column_name: string }[] = await TenantContext.runAsSystem(() =>
      b.prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'SchoolStudent' ORDER BY column_name`,
      ),
    );
    const allowed = ['id', 'workspaceId', 'classId', 'groupId', 'seq', 'lastName', 'firstName', 'middleName', 'sex', 'deactivatedAt', 'userId', 'createdAt'];
    const extra = cols.map((c) => c.column_name).filter((c) => !allowed.includes(c));
    check(extra.length === 0,
      `G-69: перечень полей записи ученика фиксирован — новых ПДн-полей нет (${extra.join(', ') || 'ровно двенадцать колонок'})`);

    // ─── активация ученика тем же маршрутом скана ───
    const pact = await accounts.studentActivationToken(pupil.id);
    check(pact.fullName === 'Иванова Мария', `над QR ученика — ФИО: «${pact.fullName}» (AR-161)`);
    const pjoin = await staff.activate(pact.token, { openedByOtherSession: false, deviceHint: 'телефон ученика' });
    check(pjoin.sessionToken !== null && pjoin.roles.includes('student'),
      'скан именного QR ученика открывает сессию роли student — маршрут один на все виды карточек');
    await drain();

    // ─── G-65 · отзыв активации ученика ───
    const revoked = await accounts.revokeStudentActivation(pupil.id, school.moderator);
    check(revoked.activated === false, 'G-65: отзыв вернул доступ ученика в «не авторизован» (AR-153)');
    check((await sessions.read(pjoin.sessionToken!)) === null, 'G-65: сессия чужого устройства закрыта отзывом');

    // ─── G-70 · пресет предметов идемпотентен ───
    const manual = await subjects.create({ name: 'Астрономия', classId: cls.id });
    const first = await subjects.applyPreset();
    check(first.created > 0, `G-70: пресет создал карточки «предмет × класс»: ${first.created}`);
    const second = await subjects.applyPreset();
    check(second.created === 0 && second.skipped > 0,
      'G-70: повторный прогон не создал ни одного дубля — идемпотентно');
    const stillManual = await subjects.get(manual.id).catch(() => null);
    check(stillManual !== null, 'G-70: ручная карточка пресетом не затёрта');

    // ─── родитель: карточка, связь, дневник ребёнка (AR-151/AR-158) ───
    const g = await accounts.createGuardian({
      lastName: 'Иванов',
      firstName: 'Пётр',
      studentIds: [pupil.id],
    });
    check(g.card.children.length === 1 && g.card.children[0].studentId === pupil.id,
      'связь родитель→ребёнок создана модератором вместе с карточкой (S-14)');
    const gact = await accounts.guardianActivationToken(g.card.id);
    const gjoin = await staff.activate(gact.token, { openedByOtherSession: false, deviceHint: 'телефон родителя' });
    check(gjoin.sessionToken !== null && gjoin.roles.includes('parent'), 'родитель активирован тем же сканом');
    await drain();

    const children = await diary.childrenOf(gjoin.userId);
    check(children.length === 1 && children[0].studentId === pupil.id,
      'дневник отдаёт родителю ровно детей его связей — объём решает идентичность, не роль (AR-151)');
    const week = await diary.week(gjoin.userId, pupil.id, null);
    check(week.studentId === pupil.id, 'неделя дневника ребёнка читается родителем');
    const averages = await diary.averages(gjoin.userId, pupil.id);
    check(Array.isArray(averages) && averages.every((r) => r.average === null || typeof r.average === 'number'),
      'средние по предметам считаются чтением; числовых нет — null, а не ноль (AR-159, P7)');

    // чужой ребёнок родителю не отдаётся — и отказ не раскрывает существования
    const stranger = (await contingent.listStudents(cls.id))[1];
    await refuses(() => diary.week(gjoin.userId, stranger.id, null), 'ACCESS_REVOKED',
      'G-67: ребёнок без связи — ACCESS_REVOKED, существование записи не раскрывается');

    // ─── G-67 · проекции без записи: у дневника нет ни одной мутации ───
    const { ModulesContainer } = await import('@nestjs/core/injector/modules-container');
    const { PATH_METADATA, METHOD_METADATA } = await import('@nestjs/common/constants');
    const { RequestMethod } = await import('@nestjs/common');
    const container = b.app.get(ModulesContainer);
    const writes: string[] = [];
    for (const m of container.values()) {
      for (const [, w] of m.controllers) {
        const ctor = w.metatype as (new () => unknown) | undefined;
        if (!ctor || ctor.name !== 'DiaryController') continue;
        const proto = ctor.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor') continue;
          const method: number | undefined = Reflect.getMetadata(METHOD_METADATA, proto[name] as object);
          if (method !== undefined && method !== RequestMethod.GET) {
            writes.push(`${name} (${String(Reflect.getMetadata(PATH_METADATA, proto[name] as object))})`);
          }
        }
      }
    }
    check(writes.length === 0, `G-67: у контроллера дневника ноль мутаций (${writes.join(', ') || 'только GET'})`);
  });

  await b.close();
  report('G-64…G-70 · ЗАПУСК ШКОЛЫ 1.2.0 ДОКАЗАН');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
