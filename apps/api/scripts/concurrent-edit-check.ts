/**
 * G-51 (AR-109, AR-102) — **одновременная правка двумя модераторами.**
 *
 * Второй модератор — штатная фигура (AR-102), значит двое правят одно не в
 * теории. Общей блокировки версия не вводит: она дороже пилота одной школы.
 * Условная запись по версии агрегата стоит ровно на четырёх мутациях:
 *   `POST /classes/bulk`, `PUT /schedule/load`, `PUT /schedule/day-params`,
 *   `POST /schedule/confirm`.
 * Вторая запись поверх изменённого состояния отвечает `CONCURRENT_EDIT` С ИМЕНЕМ
 * второго модератора — молча победившая последняя запись здесь недопустима.
 *
 * Остальные мутации адресны либо идемпотентны, и там побеждает последняя
 * запись: это ЗАПИСАННЫЙ выбор, а не умолчание, и проверка это показывает.
 *
 * Запуск: npm --workspace apps/api run concurrent:check
 */
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { ScheduleService } from '../src/schoolium/schedule/schedule.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { bench, bootstrapSchool, check, inSchool, makeStaff, readySchool, refuses, report } from './schoolium/harness';
import type { SchoolActor } from '../src/schoolium/actor';

async function main(): Promise<void> {
  const b = await bench();
  const contingent = b.get(ContingentService);
  const schedule = b.get(ScheduleService);
  const subjects = b.get(SubjectsService);
  const state = b.get(SchoolStateService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-51 · одновременная правка двумя модераторами (AR-109)\n');

  // ─── мутация 8: массовое создание классов ───
  const school = await bootstrapSchool(b, 'Школа конкурентности');
  const second: SchoolActor = { ...school.moderator, userId: 'u-second', name: 'Петрова А. В.' };

  await inSchool(school.workspaceId, async () => {
    const reg0 = await state.register();
    check(reg0.contingentVersion === 0, 'оба модератора прочитали экран: версия контингента 0');

    await contingent.createClasses(
      { parallels: 2, letters: null, studentsPerClass: 3, groups: null, sexKind: 'boys', sexCount: 1, version: reg0.contingentVersion },
      second,
    );
    await drain();
    const reg1 = await state.register();
    check(reg1.contingentVersion === 1, `первый прогон сдвинул версию: ${reg0.contingentVersion} → ${reg1.contingentVersion}`);
    check(reg1.lastEditorName === 'Петрова А. В.', `имя второго модератора записано: ${reg1.lastEditorName}`);

    // второй прогон поверх устаревшей версии: школа из 64 классов вместо 32 не появится
    await refuses(
      () => contingent.createClasses(
        { parallels: 2, letters: null, studentsPerClass: 3, groups: null, sexKind: 'boys', sexCount: 1, version: reg0.contingentVersion },
        school.moderator,
      ),
      'CLASSES_ALREADY_EXIST',
      'повторный прогон мастера отклонён раньше версии — «32 класса вместо 8» не появятся',
    );
    check((await contingent.listClasses()).length === 2, 'классов ровно 2 — второго прогона поверх первого не случилось');
  });

  // ─── мутации 18, 20, 22: нагрузка, параметры дня, подтверждение ───
  const s = await readySchool(b, 'Школа версий');
  const other: SchoolActor = { ...s.moderator, userId: 'u-other', name: 'Петрова А. В.' };

  await inSchool(s.workspaceId, async () => {
    // PUT /schedule/load
    const load = await schedule.load();
    const staleVersion = load.version;
    await schedule.setLoad(
      { entries: load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerWeek: 6 })), version: staleVersion },
      other,
    );
    await refuses(
      () => schedule.setLoad(
        { entries: load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerWeek: 3 })), version: staleVersion },
        s.moderator,
      ),
      'CONCURRENT_EDIT',
      'PUT /schedule/load поверх изменённого состояния отклонён — часы, которых человек не видел, не затираются',
    );
    try {
      await schedule.setLoad(
        { entries: load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerWeek: 3 })), version: staleVersion },
        s.moderator,
      );
    } catch (e) {
      const msg = (e as { response?: { message?: string } }).response?.message ?? '';
      check(msg.includes('Петрова А. В.'), `отказ называет второго модератора: «${msg}»`);
      check(/Обновите экран/.test(msg), 'и предлагает перечитать экран, а не «попробуйте ещё раз»');
    }

    // PUT /schedule/day-params
    const regA = await state.register();
    await schedule.setDayParams(
      { slotsPerDay: 4, lessonMin: 45, breakMin: 10, days: 5, bigBreakAfter: 2, bigBreakMin: 30, version: regA.scheduleVersion },
      other,
    );
    await refuses(
      () => schedule.setDayParams(
        { slotsPerDay: 3, lessonMin: 45, breakMin: 10, days: 5, bigBreakAfter: 2, bigBreakMin: 30, version: regA.scheduleVersion },
        s.moderator,
      ),
      'CONCURRENT_EDIT',
      'PUT /schedule/day-params поверх изменённого состояния отклонён',
    );

    // POST /schedule/confirm
    const preview = await schedule.generate(s.moderator);
    const regB = await state.register();
    await schedule.confirm({ templateId: preview.templateId, version: regB.scheduleVersion }, other);
    await drain();
    await refuses(
      () => schedule.confirm({ templateId: preview.templateId, version: regB.scheduleVersion }, s.moderator),
      'CONCURRENT_EDIT',
      'второе подтверждение подряд отклонено — двух шаблонов и двойной материализации не будет',
    );
  });

  // ─── остальные мутации: последняя запись побеждает, и это записанный выбор ───
  await inSchool(s.workspaceId, async () => {
    const cls = (await contingent.listClasses())[0];
    const student = (await contingent.listStudents(cls.id))[0];
    await contingent.updateStudent(student.id, { lastName: 'Первый', firstName: 'Вариант', sex: 'm' }, s.moderator);
    await contingent.updateStudent(student.id, { lastName: 'Второй', firstName: 'Вариант', sex: 'm' }, other);
    await drain();
    const after = await contingent.getStudent(student.id);
    check(after.lastName === 'Второй',
      'правка одного профиля адресна: побеждает последняя запись — записанный выбор, а не умолчание (AR-109)');

    // скан QR в момент закрытия карточки закрыт одноразовостью токена
    const subject = (await subjects.list())[0];
    const token = await subjects.createBindToken(subject.id);
    const teacher = await makeStaff(b, s, ['teacher'], 'Сидоров Олег');
    await subjects.scan(token.token, { userId: teacher.userId, workspaceId: s.workspaceId, roles: ['teacher'], name: 'Сидоров Олег' });
    await subjects.bindTeacher(subject.id, { token: token.token, scope: 'class' }, s.moderator);
    await refuses(
      () => subjects.bindTeacher(subject.id, { token: token.token, scope: 'class' }, other),
      'TOKEN_USED',
      'скан в момент закрытия карточки закрыт одноразовостью: вторая операция получает TOKEN_USED',
    );
  });

  await b.close();
  report('G-51 · ОДНОВРЕМЕННАЯ ПРАВКА ДОКАЗАНА');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
