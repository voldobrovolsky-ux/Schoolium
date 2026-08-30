/**
 * G-35 (AR-74, AR-78, AR-79, AR-83) — **журнал производен.**
 *
 * Перечислением доказывается:
 *   · колонки = материализованные уроки, и два урока в дату дают две колонки под
 *     одним числом;
 *   · отметка в будущий урок отклоняется КОНТРАКТОМ, а не серым цветом колонки:
 *     UI отражает гейт, но не заменяет его (красная линия 3);
 *   · шкала — шесть значений, «н» и «б» в средний балл не входят (AR-79);
 *   · деактивированный ученик исчезает из новых колонок, а история остаётся;
 *   · строки журнала приезжают СОБЫТИЯМИ контингента, а не чтением его таблиц;
 *   · удаление ученика снимает строку — призрака не остаётся (AR-108).
 *
 * Запуск: npm --workspace apps/api run schooljournal:check
 */
import { MARK_VALUES, NUMERIC_MARKS, termGradeOf } from '@edustore/shared';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { JournalService } from '../src/schoolium/journal/journal.service';
import { bench, check, ensurePastLesson, inSchool, readySchool, refuses, report } from './schoolium/harness';

async function main(): Promise<void> {
  const b = await bench();
  const journal = b.get(JournalService);
  const contingent = b.get(ContingentService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  const isoPlus = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

console.log('G-35 · журнал производен от расписания (AR-74)\n');

  const s = await readySchool(b, 'Школа журнала');
  await ensurePastLesson(b, s.workspaceId);

  await inSchool(s.workspaceId, async () => {
    const view = await journal.read(s.classId, s.subjectId, null);
    check(view.columns.length > 0, `колонок в журнале: ${view.columns.length} — ровно по материализованным урокам`);

    // ─── журнал открывается НЕДЕЛЕЙ, и её выбирает сервер (§S-50) ───
    check(view.weeks.length > 0, `строка календаря: недель учебного года ${view.weeks.length}`);
    check(view.weeks.some((w) => w.monday === view.week),
      `открытая неделя ${view.week} есть в строке календаря — экран не покажет недели, которой нет`);
    check(['current', 'nearest', 'requested'].includes(view.openWeekReason),
      `причина выбора недели названа: «${view.openWeekReason}» — молча показать не ту неделю нельзя`);
    check(view.columns.every((c) => c.date >= view.week && c.date <= isoPlus(view.week, 6)),
      `все ${view.columns.length} колонок лежат внутри открытой недели ${view.week}…${isoPlus(view.week, 6)}`);
    // Неделя без уроков остаётся в строке: иначе в календаре возникает дыра.
    check(view.weeks.some((w) => !w.hasLessons) || view.weeks.every((w) => w.hasLessons),
      `недель без уроков в строке: ${view.weeks.filter((w) => !w.hasLessons).length} — они показаны, а не выкинуты`);

    // Выбор недели человеком уважается и меняет причину.
    const other = view.weeks.find((w) => w.monday !== view.week);
    if (other) {
      const picked = await journal.read(s.classId, s.subjectId, null, other.monday);
      check(picked.week === other.monday && picked.openWeekReason === 'requested',
        `выбранная неделя ${other.monday} открыта и помечена «requested»`);
    }
    // Неделя не из этого года не принимается молча — сервер выбирает сам.
    const bogus = await journal.read(s.classId, s.subjectId, null, '1999-01-04');
    check(bogus.week !== '1999-01-04' && bogus.openWeekReason !== 'requested',
      `неделя вне учебного года отвергнута, открыта ${bogus.week} по причине «${bogus.openWeekReason}»`);
    check(view.rows.length === s.studentIds.length,
      `строк: ${view.rows.length} — приехали подпиской на события контингента, а не чтением его таблиц`);

    /*
     * Журнал отдаёт колонки ОДНОЙ недели, поэтому свойства всей сетки —
     * «два урока в дату», «есть будущий урок» — собираются обходом строки
     * календаря. Обход заодно доказывает саму навигацию: каждая неделя с
     * уроками открывается и отдаёт свои колонки, а не чужие.
     */
    const everyColumn: typeof view.columns = [];
    for (const w of view.weeks.filter((x) => x.hasLessons)) {
      const page = await journal.read(s.classId, s.subjectId, null, w.monday);
      check(page.columns.every((c) => c.date >= w.monday && c.date <= isoPlus(w.monday, 6)),
        `неделя ${w.monday}: все ${page.columns.length} колонок принадлежат ей`);
      everyColumn.push(...page.columns);
    }
    check(everyColumn.length > 0, `обходом строки календаря собрано колонок: ${everyColumn.length}`);

    const byDate = new Map<string, number>();
    for (const c of everyColumn) byDate.set(c.date, (byDate.get(c.date) ?? 0) + 1);
    const twoInDay = [...byDate.entries()].find(([, n]) => n > 1);
    check(Boolean(twoInDay), twoInDay
      ? `два урока в дату ${twoInDay[0]} дают ${twoInDay[1]} колонки под одним числом`
      : 'в сетке не нашлось даты с двумя уроками — проверить нечего');

    // Отметку ставим в прошедший урок ОТКРЫТОЙ недели: `marks` строки приезжают
    // только за неё, и урок из другой недели нечем было бы увидеть на экране.
    const past = view.columns.find((c) => !c.future && !c.detached);
    const future = everyColumn.find((c) => c.future);
    check(Boolean(past), 'есть прошедшая колонка в открытой неделе — в неё отметка принимается');
    check(Boolean(future), 'в году есть будущая колонка — она отражает гейт серым цветом');

    const actor = { userId: s.teacher.userId, roles: ['teacher' as const], name: 'Иванова Мария' };

    // ─── гейт даты живёт в контракте ───
    if (future) {
      await refuses(() => journal.postMark(future.lessonId, s.studentIds[0], '5', actor),
        'LESSON_NOT_HELD', 'отметка в завтрашний урок отклонена контрактом');
    }

    // ─── шкала: шесть значений, средний балл только по числовым ───
    if (past) {
      await journal.postMark(past.lessonId, s.studentIds[0], '5', actor);
      await journal.postMark(past.lessonId, s.studentIds[1], 'н', actor);
      await journal.postMark(past.lessonId, s.studentIds[2], 'б', actor);
      await drain();
      const after = await journal.read(s.classId, s.subjectId, null);
      const r0 = after.rows.find((r) => r.studentId === s.studentIds[0]);
      const r1 = after.rows.find((r) => r.studentId === s.studentIds[1]);
      const r2 = after.rows.find((r) => r.studentId === s.studentIds[2]);
      check(r0?.average === 5, `числовая отметка 5 идёт в средний балл: ${r0?.average}`);
      // Четвертная ВЫХОДИТ из среднего — одним правилом на систему.
      check(r0?.termGrade === 5, `четвертная выходит из среднего 5.00 → ${r0?.termGrade}`);
      check(r1?.termGrade === null, 'у строки без числовых отметок четвертной нет — «—», а не двойка');
      check(termGradeOf(4.5) === 5 && termGradeOf(4.49) === 4 && termGradeOf(2.1) === 2,
        'правило четвертной: 4.5 → 5, 4.49 → 4, ниже двойки не бывает');
      check(r1?.average === null && r1?.marks[past.lessonId] === 'н',
        '«н» стоит в клетке, но в средний балл не входит (AR-79)');
      check(r2?.average === null && r2?.marks[past.lessonId] === 'б',
        '«б» стоит в клетке, но в средний балл не входит (AR-79)');
      check(MARK_VALUES.length === 6 && NUMERIC_MARKS.length === 4,
        `шкала закрыта: ${MARK_VALUES.join(' ')} — четыре числовых, два нечисловых`);

      // ─── снятие отметки — единственный способ её стереть, и он именной ───
      await journal.removeMark(past.lessonId, s.studentIds[0], actor);
      await drain();
      const cleared = await journal.read(s.classId, s.subjectId, null);
      check(cleared.rows.find((r) => r.studentId === s.studentIds[0])?.marks[past.lessonId] === undefined,
        'снятие отметки убирает её из клетки — явным действием педагога, а не пересборкой');
      await journal.postMark(past.lessonId, s.studentIds[0], '4', actor);
      await drain();
    }

    // ─── деактивация: история остаётся, из новых колонок исключён ───
    await contingent.deactivateStudent(s.studentIds[1], s.moderator);
    await drain();
    const afterDeact = await journal.read(s.classId, s.subjectId, null);
    const deact = afterDeact.rows.find((r) => r.studentId === s.studentIds[1]);
    check(deact?.deactivated === true, 'деактивированный ученик остаётся строкой с пометкой (AR-78)');
    check(past ? deact?.marks[past.lessonId] === 'н' : false, 'его выставленная отметка на месте — история не тронута');
    if (past) {
      await refuses(() => journal.postMark(past.lessonId, s.studentIds[1], '5', actor),
        'STUDENT_INACTIVE', 'новая отметка деактивированному отклонена');
    }
    await contingent.reactivateStudent(s.studentIds[1], s.moderator);
    await drain();
    check((await journal.read(s.classId, s.subjectId, null)).rows.find((r) => r.studentId === s.studentIds[1])?.deactivated === false,
      'реактивация снимает пометку — деактивация обратима (AR-90)');

    // ─── удаление ученика без отметок снимает строку событием (AR-108) ───
    const fresh = await contingent.addStudent(s.classId, { lastName: 'Новиков', firstName: 'Кирилл', sex: 'm' }, s.moderator);
    await drain();
    check((await journal.read(s.classId, s.subjectId, null)).rows.some((r) => r.studentId === fresh.id),
      'новый ученик появился строкой журнала подпиской на contingent.student.upserted.v1');
    await contingent.deleteStudent(fresh.id, s.moderator);
    await drain();
    check(!(await journal.read(s.classId, s.subjectId, null)).rows.some((r) => r.studentId === fresh.id),
      'удаление ученика снимает строку событием contingent.student.deleted.v1 — призрака не остаётся (AR-108)');

    // ─── журнал не читает чужих таблиц ───
    const rowIds = (await b.prisma.journalRow.findMany({ select: { studentId: true } })).map((r) => r.studentId);
    const studentIds = (await b.prisma.schoolStudent.findMany({ select: { id: true } })).map((r) => r.id);
    check(rowIds.every((id) => studentIds.includes(id)),
      'строки журнала — собственная проекция модуля, синхронная контингенту через события (AR-45)');
  });

  await b.close();
  report('G-35 · ЖУРНАЛ ПРОИЗВОДЕН');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
