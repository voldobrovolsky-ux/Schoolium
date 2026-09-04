/**
 * G-88 (AR-206, AR-207) — **предпочтения педагога и замена урока.**
 *
 * Перечислением на школе из двух классов с «Математикой» в каждом (педагоги:
 * Иванова — 1 класс, Петров — 2 класс, Кузнецов — вторая привязка к предмету
 * 1 класса без часов, Сидорова — вторая привязка к предмету 2 класса без часов):
 *   · отмена своего будущего урока находит свободного педагога ТОГО ЖЕ предмета
 *     (ранг 1), при его нерабочем дне — той же дисциплины в другом классе
 *     (ранг 2, AR-201); занятого в слоте и не работающего в этот день (AR-206)
 *     не назначает никогда;
 *   · чужой урок — `NOT_YOUR_LESSON` с фамилией; прошедший и начавшийся —
 *     `LESSON_ALREADY_HELD` с датой и временем позиции; повторная отмена —
 *     `LESSON_CANCELLED`; урок вне расписания — `LESSON_DETACHED`;
 *   · журнал узнаёт о заместителе СОБЫТИЕМ `schedule.lesson.reassigned.v1`:
 *     заместитель ставит отметку, исходный педагог получает отказ как в чужом
 *     уроке; отзыв возвращает урок исходному тем же событием обратно;
 *   · без кандидата — `no_substitute`, `schedule.lesson.cancelled.v1`, колонка
 *     `cancelledAt`, отметка — `LESSON_CANCELLED` раньше гейта даты; дневник —
 *     «Урок отменён» / «Замена: Фамилия И.»; отзыв — `restored`, пометка снята;
 *   · ручная замена строителем: занятый в слоте — `SUBSTITUTE_BUSY` с фамилией
 *     и классом, свободный — `reassigned` с причиной `manual`, отмена без замены
 *     после ручного назначения перестаёт быть отменой;
 *   · события — в `EVENT_CONTRACT` с подписчиком «журнал», с подписью
 *     `AUDIT_LABELS`, опубликованы из outbox и лежат в аудите;
 *   · предпочтения (AR-206): событие `schedule.preference.set.v1` роняет
 *     подтверждённую сетку в `stale`; `TEACHER_DAYS_SHORT` — в арифметических
 *     отказах контракта; генератор чтит рабочие дни и отказывает до перебора —
 *     эти два утверждения проверяются, когда генератор объявляет поддержку
 *     `teacherDays` (реализация A1 пакета 04.09); до того печатаются как «ожидает».
 *
 * Время фиксируется `SCHOOL_TODAY`/`SCHOOL_NOW` для минутного гейта, как в G-75;
 * «прошедший» урок стенд получает переносом даты — приём стенда, не продукта.
 *
 * Запуск: npm --workspace apps/api run teacher:check
 */
import { ARITHMETIC_REFUSALS } from '@edustore/shared';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { newEvent } from '../src/common/events/domain-event';
import { AUDITED_TYPES } from '../src/common/audit/audit.service';
import { AUDIT_LABELS, EVENT_CONTRACT, SCHOOL_EVENTS, type PreferenceSetV1 } from '../src/schoolium/schoolium.contract';
import type { SchoolActor } from '../src/schoolium/actor';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { CalendarService } from '../src/schoolium/calendar/calendar.service';
import { ScheduleService } from '../src/schoolium/schedule/schedule.service';
import { SubstitutionService } from '../src/schoolium/schedule/substitution.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import { JournalService } from '../src/schoolium/journal/journal.service';
import { DiaryService } from '../src/schoolium/diary/diary.service';
import { arithmeticRefusal, generate, type GenInput } from '../src/schoolium/schedule/generator';
import { bench, bootstrapSchool, check, day, inSchool, makeStaff, refuses, report, type Bench } from './schoolium/harness';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const parseDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const dayNoOf = (d: Date): number => (d.getUTCDay() + 6) % 7;
const mondayOf = (d: Date): string => {
  const m = new Date(d);
  m.setUTCDate(m.getUTCDate() - dayNoOf(m));
  return iso(m);
};
const dm = (d: Date): string => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Утверждения, которые заработают после слияния с реализацией A1 (генератор с `teacherDays`). */
let waiting = 0;
const pending = (m: string): void => {
  waiting += 1;
  console.log(`⋯  ${m} — ожидает A1`);
};

/** Отказ именно этим кодом И с ожидаемыми деталями (объект и цифры, §9). */
async function refusesWith(fn: () => Promise<unknown>, code: string, pred: (d: Record<string, unknown>) => boolean, m: string): Promise<void> {
  try {
    await fn();
    check(false, `${m} — операция прошла, а должна была отклониться кодом ${code}`);
  } catch (e) {
    const body = (e as { response?: { code?: string; details?: Record<string, unknown> } }).response;
    const actual = body?.code ?? (e as Error).message;
    check(actual === code && pred(body?.details ?? {}), `${m} → ${actual} ${JSON.stringify(body?.details ?? {})}`);
  }
}

type Staff = { userId: string; cardId: string };

/**
 * Школа из двух классов: в каждом «Математика» на весь класс, 10 часов в
 * неделю при двух уроках в день на пятидневке — сетка заполнена целиком, и
 * педагог второго класса занят в КАЖДОМ слоте первого (детерминированный
 * `SUBSTITUTE_BUSY`). Вторые привязки без часов дают свободных кандидатов
 * ранга 1 (Кузнецов, тот же предмет) и ранга 2 (Сидорова, та же дисциплина
 * в другом классе). Путь — тот же, что у модератора: мастер → предметы →
 * привязки → четверти → нагрузка → приоритеты → параметры дня → генерация →
 * подтверждение; прямых вставок в таблицы нет.
 */
async function twoClassSchool(b: Bench) {
  const contingent = b.get(ContingentService);
  const subjects = b.get(SubjectsService);
  const calendar = b.get(CalendarService);
  const schedule = b.get(ScheduleService);
  const state = b.get(SchoolStateService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  const school = await bootstrapSchool(b, 'Школа педагога');
  const t1 = await makeStaff(b, school, ['teacher'], 'Иванова Мария');
  const t2 = await makeStaff(b, school, ['teacher'], 'Петров Павел');
  const t3 = await makeStaff(b, school, ['teacher'], 'Сидорова Ольга');
  const t4 = await makeStaff(b, school, ['teacher'], 'Кузнецов Игорь');

  return inSchool(school.workspaceId, async () => {
    await contingent.createClasses(
      { parallels: 2, letters: null, studentsPerClass: 3, groups: null, sexKind: 'boys', sexCount: 2, version: 0 },
      school.moderator,
    );
    await drain();
    const classes = (await contingent.listClasses()).sort((a, b2) => a.parallel - b2.parallel);
    const [c1, c2] = classes;
    const fio = [['Абалкин', 'Юрий'], ['Егоров', 'Пётр'], ['Ёлкина', 'Анна']];
    for (const cls of [c1, c2]) {
      const roster = await contingent.listStudents(cls.id);
      for (let i = 0; i < roster.length; i += 1) {
        await contingent.updateStudent(roster[i].id, { lastName: fio[i][0], firstName: fio[i][1], sex: i < 2 ? 'm' : 'f' }, school.moderator);
      }
    }
    await drain();

    const m1 = await subjects.create({ name: 'Математика', classId: c1.id });
    const m2 = await subjects.create({ name: 'Математика', classId: c2.id });
    for (const [sid, t] of [[m1.id, t1], [m1.id, t4], [m2.id, t2], [m2.id, t3]] as [string, Staff][]) {
      await subjects.bindTeacherManual(sid, { teacherId: t.userId, scope: 'class' }, school.moderator);
    }
    await drain();

    await calendar.setTerms(
      [
        { termNo: 1, dateFrom: day(-60), dateTo: day(60) },
        { termNo: 2, dateFrom: day(70), dateTo: day(130) },
        { termNo: 3, dateFrom: day(140), dateTo: day(200) },
        { termNo: 4, dateFrom: day(210), dateTo: day(270) },
      ],
      school.moderator,
    );
    await drain();

    const load = await schedule.load();
    const busyTeachers = new Set([t1.userId, t2.userId]);
    await schedule.setLoad(
      { entries: load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerYear: busyTeachers.has(e.teacherId) ? 10 * 34 : 0 })), version: load.version },
      school.moderator,
    );
    await schedule.setPriorities({ subjectIds: [], explicitNone: true });
    const reg = await state.register();
    await schedule.setDayParams(
      { slotsPerDay: 2, lessonMin: 45, breakMin: 10, days: 5, bigBreakAfter: 2, bigBreakMin: 20, version: reg.scheduleVersion },
      school.moderator,
    );
    const preview = await schedule.generate(school.moderator);
    const reg2 = await state.register();
    await schedule.confirm({ templateId: preview.templateId, version: reg2.scheduleVersion }, school.moderator);
    await drain();

    const students = await contingent.listStudents(c1.id);
    return { ...school, c1, c2, m1, m2, t1, t2, t3, t4, studentIds: students.map((s) => s.id) };
  });
}

async function main(): Promise<void> {
  const b = await bench();
  const prisma = b.get(PrismaService);
  const outbox = b.get(OutboxService);
  const substitution = b.get(SubstitutionService);
  const journal = b.get(JournalService);
  const diary = b.get(DiaryService);
  const state = b.get(SchoolStateService);
  const scheduleSvc = b.get(ScheduleService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-88 · предпочтения педагога и замена урока (AR-206, AR-207)\n');

  const s = await twoClassSchool(b);
  const teacherActor = (t: Staff, name: string): SchoolActor => ({ userId: t.userId, workspaceId: s.workspaceId, roles: ['teacher'], name });
  const ivanova = teacherActor(s.t1, 'Иванова Мария');
  const petrov = teacherActor(s.t2, 'Петров Павел');
  const sidorova = teacherActor(s.t3, 'Сидорова Ольга');
  const kuznetsov = teacherActor(s.t4, 'Кузнецов Игорь');
  const builder: SchoolActor = { ...s.moderator, roles: ['moderator'] }; // schedule.build без lesson.cancel.self
  const admin: SchoolActor = { ...s.moderator, roles: ['admin'] };
  const journalActor = (a: SchoolActor) => ({ userId: a.userId, roles: a.roles, name: a.name });
  const today = parseDay(day(0));

  await inSchool(s.workspaceId, async () => {
    const lessonsOf = (teacherId: string) =>
      prisma.schoolLesson.findMany({ where: { teacherId, detachedAt: null, date: { gt: today } }, orderBy: [{ date: 'asc' }, { slotNo: 'asc' }] });
    const lesson = (id: string) => prisma.schoolLesson.findUniqueOrThrow({ where: { id } });
    const column = (lessonId: string) => prisma.journalColumn.findUniqueOrThrow({ where: { lessonId } });
    const sub = (lessonId: string) => prisma.lessonSubstitution.findUnique({ where: { lessonId } });
    const setDays = async (t: Staff, workDays: number[]) => {
      await prisma.teacherPreference.upsert({
        where: { workspaceId_teacherId: { workspaceId: s.workspaceId, teacherId: t.userId } },
        update: { workDays },
        create: { workspaceId: s.workspaceId, teacherId: t.userId, workDays },
      });
    };
    const clearDays = () => prisma.teacherPreference.deleteMany({});
    const allDaysBut = (dayNo: number) => [0, 1, 2, 3, 4].filter((d) => d !== dayNo);
    /** Приём СТЕНДА: перенос урока и его колонки в прошлое — прод даты уроков не двигает. */
    const moveTo = async (lessonId: string, date: Date) => {
      await prisma.schoolLesson.update({ where: { id: lessonId }, data: { date } });
      await prisma.journalColumn.updateMany({ where: { lessonId }, data: { date } });
    };
    const eventsOf = (type: string) =>
      TenantContext.runAsSystem(() => prisma.outboxEvent.findMany({ where: { workspaceId: s.workspaceId, type }, orderBy: { createdAt: 'asc' } }));

    // ─── 0. стенд: сетка заполнена, кандидаты без часов свободны ───
    const own = await lessonsOf(s.t1.userId);
    check(own.length >= 8, `будущих уроков Ивановой материализовано: ${own.length} (горизонт 3 недели, AR-101)`);
    check((await lessonsOf(s.t4.userId)).length === 0 && (await lessonsOf(s.t3.userId)).length === 0,
      'Кузнецов и Сидорова без часов — уроков у них нет, они свободны в любом слоте');
    check((await state.resolve()) === 'ready', 'школа в ready — сетка подтверждена');

    // ─── 1. датированный оверлей `GET /schedule/lessons` ───
    const dated = await substitution.listLessons(day(0), day(21), { teacherId: s.t1.userId }, ivanova);
    check(dated.length === own.length + (await prisma.schoolLesson.count({ where: { teacherId: s.t1.userId, date: today } })),
      `оверлей недель отдаёт ${dated.length} датированных уроков Ивановой с датой, позицией и именами`);
    check(dated.every((l) => l.teacherName === 'Иванова Мария' && l.classLabel === s.c1.label && l.subjectName === 'Математика' && l.substitution === null && !l.detached),
      'у каждого урока — педагог, класс и предмет словами, замены нет, вне расписания нет');
    check((await substitution.listLessons(day(0), day(21), { classId: s.c2.id }, ivanova)).every((l) => l.teacherId === s.t2.userId),
      'фильтр по классу отдаёт уроки второго класса — все у Петрова');

    // ─── 2. отмена своего урока: заместитель ранга 1, журнал по событию ───
    const L1 = own[0];
    const r1 = await substitution.cancel(L1.id, ivanova, { reason: 'training', reasonText: 'курсы повышения квалификации' });
    check(r1.status === 'substituted' && r1.substituteTeacherId === s.t4.userId && r1.substituteTeacherName === 'Кузнецов Игорь',
      `отмена своего урока: найден заместитель ранга 1 (тот же предмет) — ${r1.substituteTeacherName}`);
    check((await lesson(L1.id)).teacherId === s.t4.userId, 'SchoolLesson.teacherId переписан на заместителя — фактический ведущий один');
    const rec1 = await sub(L1.id);
    check(rec1?.status === 'substituted' && rec1.originalTeacherId === s.t1.userId && rec1.reason === 'training' && rec1.requestedBy === s.t1.userId,
      'запись LessonSubstitution: исходный педагог, заместитель, причина из словаря, кто запросил');
    check((await column(L1.id)).teacherId === s.t1.userId, 'до доставки события колонка журнала ещё у исходного педагога — журнал не читает таблиц расписания');
    await drain();
    check((await column(L1.id)).teacherId === s.t4.userId, 'после schedule.lesson.reassigned.v1 колонка журнала переписана на заместителя (AR-74)');

    const forBuilder = (await substitution.listLessons(iso(L1.date), iso(L1.date), {}, builder)).find((l) => l.lessonId === L1.id);
    check(forBuilder?.substitution?.status === 'substituted' && forBuilder.substitution.reasonText === 'курсы повышения квалификации' && forBuilder.teacherId === s.t4.userId,
      'строителю (schedule.build) в оверлее виден заместитель и текст причины');
    const forTeacher = (await substitution.listLessons(iso(L1.date), iso(L1.date), { teacherId: s.t1.userId }, ivanova)).find((l) => l.lessonId === L1.id);
    check(Boolean(forTeacher) && forTeacher!.substitution?.reasonText === null && forTeacher!.substitution?.substituteTeacherName === 'Кузнецов Игорь',
      'исходному педагогу урок остаётся в его неделе с маркером «Замена: …», текст причины скрыт (AR-207)');

    // Стенд: урок переносится в прошлое, чтобы гейт даты журнала открылся.
    await moveTo(L1.id, parseDay(day(-1)));
    await journal.postMark(L1.id, s.studentIds[0], '5', journalActor(kuznetsov));
    check(true, 'заместитель ставит отметку в переданный ему урок');
    await refuses(() => journal.postMark(L1.id, s.studentIds[1], '4', journalActor(ivanova)),
      'нет права записи в этот урок', 'исходный педагог в переданном уроке — отказ как в чужом');

    // ─── 3. отзыв замены: урок возвращается исходному тем же событием обратно ───
    // Пока урок лежит в прошлом (его провёл заместитель и поставил отметку), отзыв
    // отклонён: он переписал бы педагога у ПРОВЕДЁННОГО урока, и отметка Кузнецова
    // оказалась бы в уроке, который «ведёт» Иванова (регрессия ревью 1.5.0).
    await refusesWith(() => substitution.withdraw(L1.id, ivanova), 'LESSON_ALREADY_HELD',
      (d) => typeof d.date === 'string' && typeof d.time === 'string',
      'отзыв отмены прошедшего урока отклонён — историю проведённого урока не переписывают');
    // Стенд возвращает урок в будущее: дальше проверяется сам механизм отзыва.
    await moveTo(L1.id, L1.date);
    await substitution.withdraw(L1.id, ivanova);
    check((await lesson(L1.id)).teacherId === s.t1.userId && (await sub(L1.id))?.status === 'withdrawn', 'отзыв: teacherId урока снова у Ивановой, запись — withdrawn');
    await drain();
    check((await column(L1.id)).teacherId === s.t1.userId, 'колонка журнала вернулась исходному педагогу по обратному reassigned');
    // Урок снова в прошлом: дальше проверяются права на отметки проведённого урока.
    await moveTo(L1.id, parseDay(day(-1)));
    const back = (await eventsOf(SCHOOL_EVENTS.lessonReassigned)).map((e) => e.payload as { toTeacherId: string; reason: string });
    check(back.some((p) => p.toTeacherId === s.t1.userId && p.reason === 'withdrawn'), 'обратное событие несёт to = исходный педагог и причину withdrawn');
    await journal.postMark(L1.id, s.studentIds[1], '4', journalActor(ivanova));
    check(true, 'после отзыва исходный педагог снова ставит отметку');
    await refuses(() => journal.postMark(L1.id, s.studentIds[2], '3', journalActor(kuznetsov)),
      'нет права записи в этот урок', 'бывший заместитель после отзыва в урок не пускается');
    check((await prisma.mark.count({ where: { lessonId: L1.id } })) === 2, 'отметка, поставленная заместителем до отзыва, не тронута');

    // ─── 4. прошедший урок отменить нельзя — с датой и временем ───
    await refusesWith(() => substitution.cancel(L1.id, ivanova, { reason: 'other' }), 'LESSON_ALREADY_HELD',
      (d) => d.date === dm(parseDay(day(-1))) && typeof d.time === 'string' && /^\d{2}:\d{2}$/.test(d.time as string),
      'вчерашний урок — LESSON_ALREADY_HELD с датой и временем начала');

    // ─── 5. ранг 2: та же дисциплина в другом классе, когда ранг 1 не работает в этот день ───
    const L2 = own[1];
    await setDays(s.t4, allDaysBut(dayNoOf(L2.date)));
    const r2 = await substitution.cancel(L2.id, ivanova, { reason: 'training' });
    check(r2.status === 'substituted' && r2.substituteTeacherId === s.t3.userId,
      `нерабочий день Кузнецова (AR-206) → заместитель ранга 2, та же дисциплина в другом классе: ${r2.substituteTeacherName}`);
    await drain();
    const diaryUser = `u-${s.studentIds[0]}`;
    await TenantContext.runAsSystem(() => prisma.user.create({ data: { id: diaryUser, firstName: 'Юрий', lastName: 'Абалкин', displayName: 'Абалкин Юрий' } }));
    await prisma.schoolStudent.update({ where: { id: s.studentIds[0] }, data: { userId: diaryUser } });
    const week2 = await diary.week(diaryUser, null, mondayOf(L2.date));
    const d2 = week2.days.flatMap((d) => d.lessons).find((l) => l.lessonId === L2.id);
    check(d2?.substituteName === 'Сидорова О.' && d2.cancelled === false, `дневник ученика: «Замена: ${d2?.substituteName}» — фамилия и инициал, без причины`);

    // ─── 6. без кандидата: no_substitute, колонка отменена, отметка — LESSON_CANCELLED ───
    const L3 = own[2];
    await setDays(s.t3, allDaysBut(dayNoOf(L3.date)));
    await setDays(s.t4, allDaysBut(dayNoOf(L3.date)));
    const r3 = await substitution.cancel(L3.id, ivanova, { reason: 'absence' });
    check(r3.status === 'no_substitute' && r3.substituteTeacherId === null, 'оба кандидата не работают в этот день → no_substitute, а не молчание');
    check((await lesson(L3.id)).teacherId === s.t1.userId, 'урок без замены остаётся за исходным педагогом');
    await drain();
    check((await column(L3.id)).cancelledAt !== null, 'после schedule.lesson.cancelled.v1 колонка журнала помечена cancelledAt');
    await refuses(() => journal.postMark(L3.id, s.studentIds[0], '5', journalActor(ivanova)), 'LESSON_CANCELLED',
      'отметка в отменённый урок — LESSON_CANCELLED раньше гейта даты (урок будущий)');
    await refuses(() => journal.postMark(L3.id, s.studentIds[0], '5', journalActor(admin)), 'LESSON_CANCELLED',
      'полные права администратора отмену не обходят');
    const noSub = (await substitution.listLessons(day(0), day(21), {}, builder)).filter((l) => l.substitution?.status === 'no_substitute');
    check(noSub.length === 1 && noSub[0].lessonId === L3.id, 'оверлей: «уроков без замены: 1» — источник плашки S-40.banner.noSubstitute');
    const week3 = await diary.week(diaryUser, null, mondayOf(L3.date));
    const d3 = week3.days.flatMap((d) => d.lessons).find((l) => l.lessonId === L3.id);
    check(d3?.cancelled === true && d3.substituteName === null, 'дневник ученика: «Урок отменён», заместителя нет');

    await substitution.withdraw(L3.id, ivanova);
    await drain();
    check((await column(L3.id)).cancelledAt === null && (await sub(L3.id))?.status === 'withdrawn',
      'отзыв отмены: schedule.lesson.restored.v1 снял пометку cancelledAt');
    await refuses(() => journal.postMark(L3.id, s.studentIds[0], '5', journalActor(ivanova)), 'LESSON_NOT_HELD',
      'восстановленный будущий урок снова закрыт обычным гейтом даты, а не отменой');
    await clearDays();

    // ─── 7. чужой урок — NOT_YOUR_LESSON с фамилией ведущего ───
    const L4 = own[3];
    await refusesWith(() => substitution.cancel(L4.id, petrov, { reason: 'other' }), 'NOT_YOUR_LESSON',
      (d) => d.teacher === 'Иванова Мария', 'Петров отменяет урок Ивановой — отказ называет ведущего');
    await refusesWith(() => substitution.withdraw(L2.id, petrov), 'NOT_YOUR_LESSON',
      (d) => d.teacher === 'Иванова Мария', 'отзыв чужой замены педагогом — тот же отказ');
    await substitution.withdraw(L2.id, builder);
    check((await lesson(L2.id)).teacherId === s.t1.userId, 'строитель (schedule.build) отзывает любую замену');
    await drain();

    // ─── 8. повторная отмена и урок вне расписания ───
    const r4 = await substitution.cancel(L4.id, ivanova, { reason: 'official' });
    check(r4.status === 'substituted', 'после сброса предпочтений замена снова находится');
    await refuses(() => substitution.cancel(L4.id, ivanova, { reason: 'other' }), 'LESSON_CANCELLED', 'повторная отмена того же урока — LESSON_CANCELLED');
    await refuses(() => substitution.cancel(L4.id, admin, { reason: 'other' }), 'LESSON_CANCELLED', 'и для администратора тоже');
    const L5 = own[4];
    await prisma.schoolLesson.update({ where: { id: L5.id }, data: { detachedAt: new Date() } });
    await refuses(() => substitution.cancel(L5.id, ivanova, { reason: 'other' }), 'LESSON_DETACHED', 'урок вне расписания не отменяется');
    await prisma.schoolLesson.update({ where: { id: L5.id }, data: { detachedAt: null } });

    // ─── 9. минутный гейт: сегодняшний урок закрыт с минуты начала позиции в поясе школы ───
    const L6 = own[5];
    process.env.SCHOOL_TODAY = iso(L6.date);
    process.env.SCHOOL_NOW = '23:59';
    await refusesWith(() => substitution.cancel(L6.id, ivanova, { reason: 'other' }), 'LESSON_ALREADY_HELD',
      (d) => d.date === dm(L6.date) && d.time === (L6.slotNo === 1 ? '09:00' : '09:55'),
      `сегодня после начала урока ${L6.slotNo} — LESSON_ALREADY_HELD с временем позиции (фолбэк по сетке дня)`);
    process.env.SCHOOL_NOW = '00:01';
    const r6 = await substitution.cancel(L6.id, ivanova, { reason: 'other' });
    check(r6.status === 'substituted', 'тот же урок до начала — отменяется');
    delete process.env.SCHOOL_TODAY;
    delete process.env.SCHOOL_NOW;
    await substitution.withdraw(L6.id, ivanova);
    await drain();

    // ─── 10. ручная замена строителем: занятый — SUBSTITUTE_BUSY, свободный — manual ───
    const L7 = own.slice(6).find((l) => l.id !== L4.id) ?? own[6];
    const petrovBusy = await prisma.schoolLesson.findFirst({ where: { date: L7.date, slotNo: L7.slotNo, teacherId: s.t2.userId, detachedAt: null } });
    check(Boolean(petrovBusy), 'сетка второго класса заполнена: Петров ведёт урок в том же слоте');
    await refusesWith(() => substitution.setSubstitute(L7.id, builder, { teacherId: s.t2.userId }), 'SUBSTITUTE_BUSY',
      (d) => d.teacher === 'Петров Павел' && d.classLabel === s.c2.label, 'занятый в слоте педагог — SUBSTITUTE_BUSY с фамилией и классом');
    const r7 = await substitution.setSubstitute(L7.id, builder, { teacherId: s.t3.userId });
    check(r7.status === 'substituted' && r7.substituteTeacherId === s.t3.userId && (await lesson(L7.id)).teacherId === s.t3.userId,
      'свободный педагог назначен вручную — урок переписан на него');
    const manual = (await eventsOf(SCHOOL_EVENTS.lessonReassigned)).map((e) => e.payload as { lessonId: string; reason: string; toTeacherId: string });
    check(manual.some((p) => p.lessonId === L7.id && p.reason === 'manual' && p.toTeacherId === s.t3.userId), 'событие reassigned несёт причину manual');
    const again = await substitution.setSubstitute(L7.id, builder, { teacherId: s.t3.userId });
    check(again.substituteTeacherId === s.t3.userId && (await eventsOf(SCHOOL_EVENTS.lessonReassigned)).length === manual.length,
      'повторное назначение того же заместителя идемпотентно — событий не прибавилось');
    let originalRefused = false;
    await substitution.setSubstitute(L7.id, builder, { teacherId: s.t1.userId }).catch(() => { originalRefused = true; });
    check(originalRefused, 'назначить «заместителем» исходного педагога нельзя — для этого есть отзыв');
    await refuses(() => substitution.setSubstitute(L1.id, builder, { teacherId: s.t3.userId }), 'LESSON_ALREADY_HELD', 'ручная замена в прошедший урок — LESSON_ALREADY_HELD');
    let strangerRefused = false;
    await substitution.setSubstitute(L7.id, builder, { teacherId: 'нет-такого' }).catch(() => { strangerRefused = true; });
    check(strangerRefused, 'человек без активного членства педагога заместителем не назначается');
    await drain();
    check((await column(L7.id)).teacherId === s.t3.userId, 'журнал переписал колонку на назначенного вручную');

    // отмена без замены → ручное назначение снимает отмену
    const L8 = own.slice(7).find((l) => !(iso(l.date) === iso(L7.date) && l.slotNo === L7.slotNo) && l.id !== L4.id) ?? own[7];
    await setDays(s.t3, allDaysBut(dayNoOf(L8.date)));
    await setDays(s.t4, allDaysBut(dayNoOf(L8.date)));
    const r8 = await substitution.cancel(L8.id, ivanova, { reason: 'absence' });
    await drain();
    check(r8.status === 'no_substitute' && (await column(L8.id)).cancelledAt !== null, 'урок без замены: колонка отменена');
    const r8b = await substitution.setSubstitute(L8.id, builder, { teacherId: s.t3.userId });
    await drain();
    const c8 = await column(L8.id);
    check(r8b.status === 'substituted' && c8.teacherId === s.t3.userId && c8.cancelledAt === null,
      'ручное назначение после «замены нет»: колонка у заместителя, пометка отмены снята');
    check((await sub(L8.id))?.reason === 'absence' && (await sub(L8.id))?.originalTeacherId === s.t1.userId,
      'причина и исходный педагог записи сохранены — ручная замена лишь дополняет отмену');
    await clearDays();

    // ─── 11. события: контракт, подписи, публикация, аудит ───
    const NEW = [SCHOOL_EVENTS.lessonCancelled, SCHOOL_EVENTS.lessonReassigned, SCHOOL_EVENTS.lessonRestored];
    check(NEW.every((t) => EVENT_CONTRACT.some((r) => r.type === t && r.subscribers.includes('journal') && r.reaction.length > 0)),
      'три события отмены/замены — в EVENT_CONTRACT с подписчиком «журнал» и реакцией (G-50)');
    check(NEW.every((t) => AUDIT_LABELS[t]?.action && AUDIT_LABELS[t]?.object), 'у каждого — подпись для строки аудита (AR-116)');
    for (const t of NEW) {
      const rows = await eventsOf(t);
      check(rows.length > 0 && rows.every((r) => r.status === 'PUBLISHED' && r.actor && r.actor !== 'system'),
        `${t}: ${rows.length} событий опубликовано из outbox, у каждого — идентичность действующего`);
    }
    const unaudited = NEW.filter((t) => !AUDITED_TYPES.includes(t));
    check(unaudited.length === 0, unaudited.length === 0
      ? 'все три события входят в аудит-леджер (AUDITED в audit.service)'
      : `вне аудит-леджера: ${unaudited.join(', ')} — добавить в AUDITED (apps/api/src/common/audit/audit.service.ts)`);
    const audited = await TenantContext.runAsSystem(() => prisma.auditLog.findMany({ where: { workspaceId: s.workspaceId, action: { in: NEW } } }));
    check(audited.length > 0 && audited.every((a) => a.actor !== null),
      `записей аудита по отмене/замене: ${audited.length}, у каждой назван действующий (AR-88)`);

    // ─── 12. предпочтения (AR-206): контракт и генератор ───
    check(ARITHMETIC_REFUSALS.includes('TEACHER_DAYS_SHORT'), 'TEACHER_DAYS_SHORT — среди арифметических отказов контракта');
    check((await state.resolve()) === 'ready', 'перед предпочтениями сетка ready');
    await prisma.$transaction((tx) =>
      outbox.enqueue(tx, newEvent<PreferenceSetV1>({
        type: SCHOOL_EVENTS.preferenceSet,
        workspaceId: s.workspaceId,
        actor: s.t1.userId,
        payload: { teacherId: s.t1.userId, workDays: [0, 2, 4] },
      })),
    );
    await drain();
    check((await state.resolve()) === 'stale', 'schedule.preference.set.v1 роняет подтверждённую сетку в stale (STALE_ON_EVENTS; издаёт эндпоинт A1)');

    // ─── 13. регрессии адверсарного ревью пакета 1.5.0 ───
    // (а) Отзыв отмены — та же граница времени, что у отмены: иначе он переписал бы
    //     педагога уже ПРОВЕДЁННОГО урока, и заместитель потерял бы свои отметки.
    const L9 = own[8];
    const r9 = await substitution.cancel(L9.id, ivanova, { reason: 'absence' });
    check(r9.status === 'substituted' || r9.status === 'no_substitute', `урок ${L9.slotNo} отменён для проверки отзыва`);
    process.env.SCHOOL_TODAY = iso(L9.date);
    process.env.SCHOOL_NOW = '23:59';
    await refusesWith(() => substitution.withdraw(L9.id, ivanova), 'LESSON_ALREADY_HELD',
      (d) => d.date === dm(L9.date),
      'отзыв отмены прошедшего урока отклонён — историю проведённого урока не переписывают (AR-211 ревью)');
    process.env.SCHOOL_NOW = '00:01';
    await substitution.withdraw(L9.id, ivanova);
    delete process.env.SCHOOL_TODAY;
    delete process.env.SCHOOL_NOW;
    check((await sub(L9.id))?.status === 'withdrawn', 'тот же отзыв до начала урока проходит');
    await drain();

    // (б) Отсутствующий педагог не получает чужую замену в том же слоте: его
    //     собственный урок уже отдан заместителю, и по `teacherId` он выглядел бы
    //     свободным — подбор смотрит и на записи отмен этого слота.
    const sameSlot = own.filter((l) => iso(l.date) === iso(own[9].date) && l.slotNo === own[9].slotNo);
    if (sameSlot.length) {
      const away = await substitution.cancel(own[9].id, ivanova, { reason: 'absence' });
      const foreign = await prisma.schoolLesson.findFirst({
        where: { date: own[9].date, slotNo: own[9].slotNo, detachedAt: null, id: { not: own[9].id }, teacherId: { not: ivanova.userId } },
      });
      if (foreign) {
        void away;
        const picked = await substitution.cancel(foreign.id, builder, { reason: 'official' });
        check(picked.substituteTeacherId !== ivanova.userId,
          `заместителем не назначен педагог, отменивший свой урок в этом же слоте: ${picked.substituteTeacherName ?? 'замены нет'}`);
        await substitution.withdraw(foreign.id, builder);
      } else {
        check(true, 'в слоте нет второго урока — случай «отсутствующий как кандидат» не воспроизводится на этом стенде');
      }
      await substitution.withdraw(own[9].id, ivanova).catch(() => undefined);
      await drain();
    }

    // (в) Заметка педагога — не общая: коллеге по `schedule.read` она не видна.
    await scheduleSvc.setMyPreference({ workDays: [0, 1, 2, 3, 4], note: 'по вторникам уезжаю в 15:00' }, ivanova);
    const prefsColleague = await scheduleSvc.listPreferences(petrov);
    const mine = await scheduleSvc.listPreferences(ivanova);
    const prefsBuilder = await scheduleSvc.listPreferences(builder);
    check(prefsColleague.find((r) => r.teacherId === ivanova.userId)?.note === null,
      'коллега видит рабочие дни, но не читает чужую заметку (`schedule.read` — не право на личный текст)');
    check(mine.find((r) => r.teacherId === ivanova.userId)?.note?.includes('вторникам') === true, 'автор свою заметку видит');
    check(prefsBuilder.find((r) => r.teacherId === ivanova.userId)?.note?.includes('вторникам') === true,
      'строитель сетки читает заметки — он по ним расставляет уроки');

    // (г) Сохранение без смены рабочих дней не роняет сетку: иначе любое открытие
    //     формы объявляло бы расписание школы устаревшим.
    await state.bump(prisma, 'schedule', { id: builder.userId, name: builder.name }, s.workspaceId).catch(() => undefined);
    const before13 = await state.resolve();
    await scheduleSvc.setMyPreference({ workDays: [0, 1, 2, 3, 4], note: 'та же заметка, дни те же' }, ivanova);
    await drain();
    check((await state.resolve()) === before13,
      `сохранение предпочтений без смены дней состояние сетки не трогает (было ${before13}, стало ${await state.resolve()})`);

    // Генератор: поддержка `teacherDays` объявляется отказом TEACHER_DAYS_SHORT до перебора.
    const pure: GenInput = {
      classes: [{ id: 'c', label: '5', parallel: 5, groupCount: 0 }],
      pairs: [{ subjectId: 'm', subjectName: 'Математика', classId: 'c', teacherId: 't', teacherName: 'Иванова М. И.', scope: 'class', groupNos: [], hours: 4, priority: false }],
      params: { days: 5, slotsPerDay: 2, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 20 },
      seed: 7,
      classesWithUnassignedGroups: [],
      uncovered: [],
    };
    const withDays = (days: number[]): GenInput => ({ ...pure, teacherDays: { t: days } } as GenInput);
    const probe = arithmeticRefusal(withDays([0]));
    if (probe?.code === 'TEACHER_DAYS_SHORT') {
      check(typeof probe.details.teacher === 'string' && Number(probe.details.hours) === 4 && Number(probe.details.slots) === 2,
        `TEACHER_DAYS_SHORT до перебора называет педагога и цифры: ${JSON.stringify(probe.details)}`);
      const res = generate(withDays([0, 1]));
      check(res.ok && res.slots.every((sl) => sl.dayNo === 0 || sl.dayNo === 1),
        res.ok ? 'генератор не ставит педагогу урок вне рабочих дней (ПН, ВТ)' : `генерация с рабочими днями отклонена: ${res.code}`);
    } else {
      pending('TEACHER_DAYS_SHORT до перебора с педагогом и цифрами');
      pending('генератор не ставит педагогу урок вне рабочих дней');
    }
  });

  await b.close();
  if (waiting) console.log(`\n⋯ утверждений, ожидающих слияния с A1: ${waiting}`);
  report('G-88 · ПРЕДПОЧТЕНИЯ ПЕДАГОГА И ЗАМЕНА УРОКА');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
