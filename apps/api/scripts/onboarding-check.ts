/**
 * G-33 (AR-72, AR-77) — **онбординг сквозной перечислением.**
 *
 * Модератор проходит путь `empty → ready` на пустой школе, и на каждом шаге
 * доказывается: выход вперёд есть, возврат для правки есть, данные при возврате
 * не стираются. После `ready` перечисляется таксономия правок (AR-85): правка
 * контингента оставляет школу в `ready`, правка структуры роняет сетку в `stale`,
 * но данные остаются на месте.
 *
 * Опциональные параметры мастера имеют ЯВНЫЙ отказ (AR-77): «⌀ Без литер» и
 * «⌀ Без групп» — это выбор, а не пустое поле.
 *
 * Запуск: npm --workspace apps/api run onboarding:check
 */
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { CalendarService } from '../src/schoolium/calendar/calendar.service';
import { ScheduleService } from '../src/schoolium/schedule/schedule.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import { bench, bootstrapSchool, check, inSchool, makeStaff, report } from './schoolium/harness';

async function main(): Promise<void> {
  const b = await bench();
  const contingent = b.get(ContingentService);
  const subjects = b.get(SubjectsService);
  const calendar = b.get(CalendarService);
  const schedule = b.get(ScheduleService);
  const state = b.get(SchoolStateService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-33 · сквозной онбординг школы (AR-72)\n');

  const school = await bootstrapSchool(b, 'Школа онбординга');
  const ws = school.workspaceId;
  const mod = school.moderator;

  await inSchool(ws, async () => {
    check((await state.resolve()) === 'empty', 'пустая школа: состояние empty, дом — Классы с кнопкой мастера');

    // ─── шаг 1: мастер классов, явный отказ от литер и явный выбор групп ───
    await contingent.createClasses(
      { parallels: 2, letters: null, studentsPerClass: 4, groups: 2, sexKind: 'boys', sexCount: 2, version: 0 },
      mod,
    );
    await drain();
    const classes = await contingent.listClasses();
    check(classes.length === 2 && classes.every((c) => c.letter === null),
      `«⌀ Без литер» — явный отказ, а не пустое поле: создано ${classes.length} класса без литер`);
    check(classes.every((c) => c.groupCount === 2 && c.totalProfiles === 4),
      'мастер создал классы вместе с пустыми профилями и группами');
    check((await state.resolve()) === 'classes_created', 'состояние classes_created: выход вперёд — заполнение учеников');

    // повторный прогон мастера отклоняется — «32 класса вместо 8» не появятся молча
    let repeated = 'нет отказа';
    try {
      await contingent.createClasses(
        { parallels: 2, letters: null, studentsPerClass: 4, groups: 2, sexKind: 'boys', sexCount: 2, version: 1 },
        mod,
      );
    } catch (e) {
      repeated = (e as { response?: { code?: string } }).response?.code ?? 'ошибка';
    }
    check(repeated === 'CLASSES_ALREADY_EXIST', `повторный прогон мастера → ${repeated}`);

    // ─── шаг 2: профили учеников; возврат для правки не стирает данных ───
    const names = [['Ёлкина', 'Анна'], ['Егоров', 'Пётр'], ['Елагин', 'Иван'], ['Абалкин', 'Юрий']];
    for (const c of classes) {
      const roster = await contingent.listStudents(c.id);
      for (let i = 0; i < roster.length; i += 1) {
        await contingent.updateStudent(
          roster[i].id,
          { lastName: names[i][0], firstName: names[i][1], sex: i % 2 === 0 ? 'm' : 'f' },
          mod,
        );
      }
    }
    await drain();
    const roster = await contingent.listStudents(classes[0].id);
    check(roster[0].lastName === 'Абалкин' && roster[3].lastName === 'Ёлкина',
      `сортировка Фамилия→Имя→Отчество, «ё» = «е»: ${roster.map((r) => r.lastName).join(', ')}`);
    check(roster.every((r) => r.groupNo !== null),
      'дефолт-разбиение по алфавиту применено после заполнения ФИО (AR-75)');
    check((await state.resolve()) === 'students_filled', 'состояние students_filled');

    // возврат на пройденный шаг: правка профиля не стирает соседние
    await contingent.updateStudent(roster[0].id, { lastName: 'Абалкин', firstName: 'Юрий', middleName: 'Олегович', sex: 'm' }, mod);
    await drain();
    const after = await contingent.listStudents(classes[0].id);
    check(after.length === 4 && after.find((s) => s.middleName === 'Олегович') !== undefined,
      'возврат для правки: отчество добавлено, остальные профили на месте');

    // ─── шаг 3: предметы ───
    for (const c of classes) {
      await subjects.create({ name: 'Математика', classId: c.id });
      await subjects.create({ name: 'Русский', classId: c.id });
    }
    await drain();
    check((await state.resolve()) === 'subjects_created', 'состояние subjects_created: карточка на пару «предмет × класс»');

    // ─── шаг 4: персонал ───
    const t1 = await makeStaff(b, school, ['teacher'], 'Иванова Мария');
    const t2 = await makeStaff(b, school, ['teacher'], 'Сидоров Олег');
    check((await state.resolve()) === 'staff_activated', 'состояние staff_activated: сотрудники зарегистрированы');

    // ─── шаг 5: привязка педагогов через QR ───
    const list = await subjects.list();
    for (const s of list) {
      const teacher = s.name === 'Математика' ? t1 : t2;
      const token = await subjects.createBindToken(s.id);
      await subjects.scan(token.token, { userId: teacher.userId, workspaceId: ws, roles: ['teacher'], name: 'педагог' });
      await subjects.bindTeacher(s.id, { token: token.token, scope: 'class' }, mod);
    }
    await drain();
    const bound = await subjects.list();
    check(bound.every((s) => s.coverageComplete), 'покрытие полное: у каждого предмета есть педагог на весь класс');
    check((await state.resolve()) === 'teachers_bound', 'состояние teachers_bound');

    // ─── шаг 6: четверти ───
    await calendar.setTerms(
      [
        { termNo: 1, dateFrom: '2026-09-01', dateTo: '2026-10-25' },
        { termNo: 2, dateFrom: '2026-11-05', dateTo: '2026-12-28' },
        { termNo: 3, dateFrom: '2027-01-11', dateTo: '2027-03-21' },
        { termNo: 4, dateFrom: '2027-04-01', dateTo: '2027-05-29' },
      ],
      mod,
    );
    await drain();
    check((await state.resolve()) === 'terms_set', 'состояние terms_set: даты ушли в календарь, модалка их не хранит (AR-68)');

    // ─── шаг 7: нагрузка ───
    const load = await schedule.load();
    await schedule.setLoad(
      { entries: load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerWeek: 4 })), version: load.version },
      mod,
    );
    check((await state.resolve()) === 'load_set', 'состояние load_set: часы проставлены каждой паре');

    // ─── шаг 8: приоритеты через явный отказ ───
    await schedule.setPriorities({ subjectIds: [], explicitNone: true });
    check((await state.resolve()) === 'priorities_set', '«⌀ Без приоритетов» — явный отказ засчитан выбором (AR-77)');

    // ─── шаг 9: параметры дня ───
    const reg = await state.register();
    await schedule.setDayParams(
      { slotsPerDay: 4, lessonMin: 45, breakMin: 10, days: 5, bigBreakAfter: 2, bigBreakMin: 30, version: reg.scheduleVersion },
      mod,
    );
    check((await state.resolve()) === 'day_params_set', 'состояние day_params_set: «уроков в день» собрано экраном 4 (AR-103)');

    // ─── шаг 10: генерация — ПРЕДЛОЖЕНИЕ, не решение ───
    const preview = await schedule.generate(mod);
    check((await state.resolve()) === 'generated', 'состояние generated: шаблон построен и показан модератору');
    const lessonsBefore = await b.prisma.schoolLesson.count();
    check(lessonsBefore === 0, 'до нажатия «Подтвердить» не материализовано ни одного урока (AR-18, красная линия 1)');

    // ─── шаг 11: подтверждение — единственный путь к материализации ───
    const reg2 = await state.register();
    const confirmed = await schedule.confirm({ templateId: preview.templateId, version: reg2.scheduleVersion }, mod);
    await drain();
    check((await state.resolve()) === 'ready', 'состояние ready: сетка подтверждена, школа готова');
    check(confirmed.materialized > 0, `материализовано уроков: ${confirmed.materialized}`);
    const columns = await b.prisma.journalColumn.count();
    check(columns === confirmed.materialized,
      `журнал получил ровно столько колонок, сколько уроков (${columns}) — подпиской, а не чтением таблиц расписания`);

    // ─── таксономия правок после ready (AR-85) ───
    const c0 = (await contingent.listClasses())[0];
    await contingent.addStudent(c0.id, { lastName: 'Новиков', firstName: 'Кирилл', sex: 'm' }, mod);
    await drain();
    check((await state.resolve()) === 'ready',
      'приём ученика в середине четверти НЕ поднимает плашку «расписание устарело» — численность на сетку не влияет');

    const subj = (await subjects.list())[0];
    await subjects.unbind(subj.id, subj.bindings[0].teacherId, mod);
    await drain();
    check((await state.resolve()) === 'stale',
      'открепление педагога роняет сетку в stale — уроки без исполнителя видны плашкой, а не узнаются в сентябре');
    check((await b.prisma.schoolLesson.count()) > 0, 'при переходе в stale уроки и отметки не тронуты: stale — плашка, а не пересборка');
  });

  await b.close();
  report('G-33 · ОНБОРДИНГ СКВОЗНОЙ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
