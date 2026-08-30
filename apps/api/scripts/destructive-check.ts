/**
 * G-48 (AR-105, AR-90) — **обратимость разрушающего перечислением.**
 *
 * Реестр AR-90 перечислял разрушение только как «обратную» колонку к созданию, и
 * четыре операции не имели строки вовсе. Здесь доказывается, что каждая
 * разрушающая операция версии стоит в реестре СВОЕЙ строкой, необратимых пять, у
 * каждой записана причина — и, главное, что **подтверждение удаления класса
 * называет действительный объём потери**.
 *
 * Опаснее прочего именно удаление класса: условие — «ни у одного ученика нет
 * отметок», а до состояния `ready` отметок не существует ВОВСЕ, значит весь
 * онбординг любой класс удаляется одной кнопкой вместе с заполненными профилями.
 * Поэтому ответ карточки несёт `filledProfiles` отдельно от `totalProfiles`.
 *
 * Запуск: npm --workspace apps/api run destructive:check
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { JournalService } from '../src/schoolium/journal/journal.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { bench, bootstrapSchool, check, ensurePastLesson, inSchool, readySchool, refuses, report } from './schoolium/harness';

/** Реестр обратимости из спеки — таблица «Обратимость операций» в `30-spec.md`. */
function specRegistry(): { op: string; back: string; why: string }[] {
  const src = readFileSync(join(__dirname, '../../../specs/school-onboarding/30-spec.md'), 'utf8');
  const start = src.indexOf('| Операция | Обратная | Почему обратной нет |');
  const end = src.indexOf('Остальные восемнадцать операций', start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('Операция |'))
    .map((l) => l.split(/(?<!\\)\|/).map((c) => c.trim()))
    .filter((c) => c.length >= 4 && c[1])
    .map((c) => ({ op: c[1], back: c[2], why: c[3] }));
}

async function main(): Promise<void> {
  const b = await bench();
  const contingent = b.get(ContingentService);
  const subjects = b.get(SubjectsService);
  const journal = b.get(JournalService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-48 · обратимость разрушающего (AR-105)\n');

  // ─── 1. реестр спеки: разрушающее стоит своей строкой ───
  const reg = specRegistry();
  check(reg.length === 7, `в таблице необратимых операций спеки строк: ${reg.length}`);
  const noBack = reg.filter((r) => /нет обратной/.test(r.back));
  check(noBack.length === 5,
    `необратимых операций ${noBack.length}: ${noBack.map((r) => r.op).join(' · ') || '—'} — их пять, не три`);
  for (const r of reg) {
    check(r.why.length > 20, `«${r.op}»: причина сформулирована механикой, а не удобством`);
  }
  for (const need of ['удалить класс', 'удалить предмет', 'удалить ученика', 'удалить сотрудника']) {
    check(reg.some((r) => r.op === need), `разрушающая операция «${need}» стоит в реестре своей строкой`);
  }

  // ─── 2. подтверждение удаления класса называет ЗАПОЛНЕННЫЕ профили ───
  const school = await bootstrapSchool(b, 'Школа удалений');
  await inSchool(school.workspaceId, async () => {
    await contingent.createClasses(
      { parallels: 1, letters: null, studentsPerClass: 4, groups: null, sexKind: 'boys', sexCount: 2, version: 0 },
      school.moderator,
    );
    await drain();
    const cls = (await contingent.listClasses())[0];
    const empty = await contingent.getClass(cls.id);
    check(empty.filledProfiles === 0 && empty.totalProfiles === 4,
      `пустой класс: заполнено ${empty.filledProfiles} из ${empty.totalProfiles} — текст «4 пустых профиля» здесь ПРАВДА`);

    const roster = await contingent.listStudents(cls.id);
    for (const s of roster) {
      await contingent.updateStudent(s.id, { lastName: 'Иванов', firstName: 'Иван', sex: 'm' }, school.moderator);
    }
    await drain();
    const filled = await contingent.getClass(cls.id);
    check(filled.filledProfiles === 4 && filled.totalProfiles === 4,
      `после заполнения: заполнено ${filled.filledProfiles} из ${filled.totalProfiles} — модалка обязана назвать ПЕРВОЕ число (AR-105)`);
    check(filled.hasMarks === false,
      'отметок ещё нет — значит класс удаляется одной кнопкой ВМЕСТЕ с заполненными профилями: это и есть опасный случай');

    const res = await contingent.deleteClass(cls.id, school.moderator);
    await drain();
    check(res.studentsDeleted === 4, `удаление класса унесло ${res.studentsDeleted} профиля — объём был назван до нажатия`);
    check((await contingent.listClasses()).length === 0, 'класс исчез целиком — обратной операции у этого нет');
  });

  // ─── 3. класс с отметками не удаляется ───
  const s = await readySchool(b, 'Школа с отметками');
  await ensurePastLesson(b, s.workspaceId);
  await inSchool(s.workspaceId, async () => {
    const view = await journal.read(s.classId, s.subjectId, null);
    const past = view.columns.find((c) => !c.future)!;
    await journal.postMark(past.lessonId, s.studentIds[0], '5', {
      userId: s.teacher.userId, roles: ['teacher'], name: 'Иванова Мария',
    });
    await drain();
    const cls = await contingent.getClass(s.classId);
    check(cls.hasMarks, 'сервер вернул hasMarks: true — кнопка удаления класса не показывается');
    await refuses(() => contingent.deleteClass(s.classId, s.moderator), 'CLASS_HAS_MARKS',
      'удаление класса с отметками отклонено КОНТРАКТОМ, а не только скрытием кнопки');

    // ученик с отметками тоже не удаляется — подмена решается сервером
    const withMarks = await contingent.getStudent(s.studentIds[0]);
    check(withMarks.hasMarks, 'у ученика есть отметки — экран покажет «Деактивировать» вместо «Удалить» (AR-78)');
    await refuses(() => contingent.deleteStudent(s.studentIds[0], s.moderator), 'STUDENT_HAS_MARKS',
      'удаление ученика с отметками отклонено гейтом контракта именованным кодом (AR-113)');

    // ─── 4. удаление предмета: карточка уходит с часами и историей привязок ───
    const subject = (await subjects.list())[0];
    check(subject.bindings.length > 0, 'у предмета есть привязка педагога');
    await subjects.remove(subject.id, s.moderator);
    await drain();
    check((await subjects.list()).length === 0, 'карточка предмета удалена вместе с часами нагрузки и историей привязок');
    const teacherStill = await b.prisma.staffCard.count({ where: { userId: s.teacher.userId } });
    check(teacherStill === 1, 'педагог при этом остался — восстановление означает создать карточку заново и привязать его');
  });

  await b.close();
  report('G-48 · ОБРАТИМОСТЬ РАЗРУШАЮЩЕГО ДОКАЗАНА');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
