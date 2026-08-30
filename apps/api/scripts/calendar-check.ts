/**
 * G-45 (AR-100, AR-101, AR-73) — **календарь и материализация перечислением.**
 *
 *   · справочник нерабочих дней загружен на учебный год; года без данных не
 *     бывает МОЛЧА — генерация отвечает `CALENDAR_YEAR_MISSING` с указанием года;
 *   · материализация не создаёт уроков в выходные и нерабочие дни;
 *   · повторный прогон на тех же данных создаёт НОЛЬ записей — идемпотентность и
 *     есть право на три триггера сразу;
 *   · три триггера названы поимённо;
 *   · горизонт держится на три недели вперёд.
 *
 * Запуск: npm --workspace apps/api run calendar:check
 */
import { TenantContext } from '../src/common/tenant/tenant-context';
import { CalendarContractService, CalendarService } from '../src/schoolium/calendar/calendar.service';
import { ScheduleService } from '../src/schoolium/schedule/schedule.service';
import { CALENDAR_YEARS, NON_WORKING_DAYS } from '../src/schoolium/calendar/non-working-days';
import { HORIZON_WEEKS, MATERIALIZE_TRIGGERS } from '../src/schoolium/schedule/generator';
import { bench, check, day, inSchool, readySchool, refuses, report } from './schoolium/harness';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

async function main(): Promise<void> {
  const b = await bench();
  const schedule = b.get(ScheduleService);
  const calendar = b.get(CalendarContractService);
  const terms = b.get(CalendarService);

  console.log('G-45 · календарь и скользящая материализация (AR-100, AR-101)\n');

  // ─── справочник нерабочих дней ───
  check(CALENDAR_YEARS.length > 0, `справочник нерабочих дней загружен на годы: ${CALENDAR_YEARS.join(', ')}`);
  for (const y of CALENDAR_YEARS) {
    check(NON_WORKING_DAYS[y].length > 0, `${y}: ${NON_WORKING_DAYS[y].length} нерабочих дней — генератор не угадывает праздники`);
  }
  let missing = 'нет отказа';
  try {
    calendar.assertYear(2099);
  } catch (e) {
    missing = (e as { response?: { code?: string } }).response?.code ?? 'ошибка';
  }
  check(missing === 'CALENDAR_YEAR_MISSING', `год без данных → ${missing}, а не тихий пропуск праздников`);

  // ─── материализация ───
  const s = await readySchool(b, 'Школа календаря');
  await inSchool(s.workspaceId, async () => {
    const lessons = await b.prisma.schoolLesson.findMany({ orderBy: { date: 'asc' } });
    check(lessons.length > 0, `материализовано уроков: ${lessons.length}`);

    const weekend = lessons.filter((l) => [0, 6].includes(l.date.getUTCDay()));
    check(weekend.length === 0, 'уроков в выходные нет — материализация пропускает субботу и воскресенье');

    const holidays = lessons.filter((l) => calendar.nonWorking(l.date.getUTCFullYear()).includes(iso(l.date)));
    check(holidays.length === 0, 'уроков в нерабочие дни нет — мёртвых колонок в журнале не будет (Д3)');

    // идемпотентность: три триггера безопасны только благодаря ей
    const again = await schedule.materialize('повторный прогон');
    check(again === 0, `повторный прогон материализации создал ${again} записей — операция идемпотентна (AR-101)`);
    const third = await schedule.materialize('третий прогон');
    check(third === 0, 'и третий прогон тоже — ключ «дата + слот + класс + группа» держит идемпотентность');

    check(MATERIALIZE_TRIGGERS.length === 3,
      `триггеры материализации названы поимённо: ${MATERIALIZE_TRIGGERS.join(' · ')}`);
    check(HORIZON_WEEKS === 3, `горизонт видимости — ${HORIZON_WEEKS} недели вперёд, а не длина расписания (AR-73)`);

    const last = lessons[lessons.length - 1].date;
    const limit = new Date(day(HORIZON_WEEKS * 7 + 1));
    check(last <= limit, `дальний урок ${iso(last)} не выходит за горизонт ${iso(limit)}`);

    // каникулы: журнал показывает ближайший учебный день, а не «расписание не настроено»
    const inHoliday = new Date(day(65)); // между первой и второй четвертью фикстуры
    check(await calendar.onHolidays(inHoliday), `${iso(inHoliday)} — каникулы между четвертями`);
    const next = await calendar.nextSchoolDay(inHoliday);
    check(next !== null && next > iso(inHoliday),
      `в каникулы календарь называет ближайший учебный день: ${next} — пустое состояние не зовёт настраивать настроенное`);
  });

  // ─── валидация четвертей ───
  const s2 = await readySchool(b, 'Школа четвертей');
  await inSchool(s2.workspaceId, async () => {
    await refuses(
      () => terms.setTerms([{ termNo: 1, dateFrom: '2026-10-01', dateTo: '2026-09-01' }], s2.moderator),
      'TERM_REVERSED',
      'конец раньше начала отклонён',
    );
    await refuses(
      () =>
        terms.setTerms(
          [
            { termNo: 1, dateFrom: '2026-09-01', dateTo: '2026-10-25' },
            { termNo: 2, dateFrom: '2026-10-01', dateTo: '2026-12-28' },
          ],
          s2.moderator,
        ),
      'TERM_OVERLAP',
      'пересечение четвертей отклонено',
    );
  });

  await TenantContext.runAsSystem(() => b.outbox.drain());
  await b.close();
  report('G-45 · КАЛЕНДАРЬ И МАТЕРИАЛИЗАЦИЯ ДОКАЗАНЫ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
