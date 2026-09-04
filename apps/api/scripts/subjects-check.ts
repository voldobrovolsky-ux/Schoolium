/**
 * G-85 — **ключ имени предмета и слияние дублей доказаны** (AR-201).
 *
 * Карточка предмета — пара «предмет × класс»; имя сравнивается по ключу без
 * регистра (`subjectNameKey`: trim, пробелы в один, нижний регистр, «ё» → «е»).
 * Дубли прода («алгебра» и «Алгебра» после импорта) сливаются платформенной
 * операцией `subjects:merge`, ядро которой — чистая функция `mergeSubjectPair`.
 *
 * Перечислением:
 *   1. ключ и каноническое имя: регистр, пробелы, «ё», имя пресета, первая буква;
 *   2. строки импорта одного ключа объединяются: педагоги — объединение, часы — максимум;
 *   3. создание «алгебра» при существующей «Алгебра» в классе — `SUBJECT_EXISTS`
 *      с объектом и классом в details; тот же ключ в другом классе — проходит;
 *   4. пресет идемпотентен по ключу: ручная «геометрия» не даёт второй «Геометрии»;
 *   5. слияние на стенде с привязками, слотом сетки, уроком, колонкой журнала,
 *      отметкой и токеном: dry-run ничего не пишет; apply — одна карточка, все
 *      ссылки перепривязаны, одинаковые привязки слиты с часами-максимумом,
 *      отметка на месте, `priority` — ИЛИ, ключ урока сходится со слотом,
 *      версия сетки поднята; канон выбран по правилу (привязки → уроки → возраст);
 *   6. Д6-конфликт класс↔группы между дублями — пара пропускается, карточки целы.
 *
 * Запуск: npm --workspace apps/api run subjects:check
 */
import { canonicalSubjectName, subjectNameKey, weeklyOfYear } from '@edustore/shared';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { SUBJECT_PRESET } from '../src/schoolium/subjects/subject-preset';
import { findDuplicateGroups, mergeImportSubjectRows, mergeSubjectPair } from '../src/schoolium/subjects/subject-merge';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { bench, bootstrapSchool, check, inSchool, makeStaff, readySchool, refuses, report } from './schoolium/harness';

const PRESET_NAMES = SUBJECT_PRESET.map((p) => p.name);
/** Ключ урока против шаблона — та же формула, что в `schedule.service.ts` (день недели, слот, класс, группа, предмет). */
const lessonKey = (dow: number, slotNo: number, classId: string, groupNo: number, subjectId: string): string =>
  `${dow}:${slotNo}:${classId}:${groupNo}:${subjectId}`;
const dowOf = (d: Date): number => (d.getUTCDay() + 6) % 7;

async function main(): Promise<never> {
  const b = await bench();
  const subjects = b.get(SubjectsService);
  const prisma = b.get(PrismaService);

  console.log('G-85 · ключ имени предмета и слияние дублей (AR-201)\n');

  // ---------- 1. ключ и каноническое имя ----------
  check(subjectNameKey('  Алгебра ') === 'алгебра' && subjectNameKey('АЛГЕБРА') === 'алгебра',
    'ключ: trim и нижний регистр — «  Алгебра », «АЛГЕБРА» → «алгебра»');
  check(subjectNameKey('Ёлки   зелёные') === 'елки зеленые', 'ключ: пробелы схлопнуты, «ё» → «е»');
  check(canonicalSubjectName('физическая  культура', PRESET_NAMES) === 'Физическая культура',
    'канон: совпадение по ключу с пресетом даёт имя пресета');
  check(canonicalSubjectName('астрономия', PRESET_NAMES) === 'Астрономия' && canonicalSubjectName('  ', PRESET_NAMES) === '',
    'канон: вне пресета — первая буква заглавной; пустое остаётся пустым');

  // ---------- 2. строки импорта одного ключа ----------
  const rows = mergeImportSubjectRows([
    { class: 7, name: 'Алгебра', hours: 3, teachers: ['Иванова М. И.'] },
    { class: 7, name: 'алгебра', hours: 4, teachers: ['Петров П. П.', 'Иванова М. И.'] },
    { class: 8, name: 'алгебра', hours: 3, teachers: ['Петров П. П.'] },
  ]);
  const r7 = rows.find((r) => r.class === 7);
  check(rows.length === 2 && r7?.name === 'Алгебра' && r7.hours === 4 && r7.teachers.join('|') === 'Иванова М. И.|Петров П. П.',
    'импорт: две строки «Алгебра»/«алгебра» 7 класса — одна карточка, педагоги объединены, часы максимум; 8 класс — отдельно');

  // ---------- 3-4. создание и пресет по ключу ----------
  const school = await bootstrapSchool(b, 'Школа ключа имени');
  await inSchool(school.workspaceId, async () => {
    const c7 = await prisma.schoolClass.create({ data: { workspaceId: school.workspaceId, parallel: 7, letter: null, label: '7', groupCount: 0 } });
    const c8 = await prisma.schoolClass.create({ data: { workspaceId: school.workspaceId, parallel: 8, letter: null, label: '8', groupCount: 0 } });

    const alg = await subjects.create({ name: ' алгебра ', classId: c7.id });
    const stored = await prisma.schoolSubject.findUnique({ where: { id: alg.id } });
    check(alg.name === 'Алгебра' && stored?.nameKey === 'алгебра', 'create: « алгебра » сохранена как «Алгебра» пресета с nameKey «алгебра»');

    let details: { name?: string; classLabel?: string } | undefined;
    await refuses(async () => {
      try {
        await subjects.create({ name: 'алгебра', classId: c7.id });
      } catch (e) {
        details = (e as { response?: { details?: typeof details } }).response?.details;
        throw e;
      }
    }, 'SUBJECT_EXISTS', 'create: «алгебра» при существующей «Алгебра» в 7 классе — SUBJECT_EXISTS');
    check(details?.name === 'Алгебра' && details?.classLabel === '7', 'SUBJECT_EXISTS несёт объект и класс: name «Алгебра», classLabel «7»');
    await refuses(() => subjects.create({ name: 'АЛГЕБРА  ', classId: c7.id }), 'SUBJECT_EXISTS',
      'create: «АЛГЕБРА  » — тот же ключ, тот же отказ');
    check((await prisma.schoolSubject.count({ where: { classId: c7.id } })) === 1, 'после отказов в 7 классе одна карточка алгебры');
    const alg8 = await subjects.create({ name: 'алгебра', classId: c8.id });
    check(alg8.classId === c8.id && alg8.name === 'Алгебра', 'create: тот же ключ в 8 классе — отдельная карточка (пара «предмет × класс»)');
    let empty = false;
    await subjects.create({ name: '   ', classId: c7.id }).catch(() => { empty = true; });
    check(empty, 'create: пустое имя отклонено');

    const geo = await subjects.create({ name: 'геометрия', classId: c7.id });
    const preset = await subjects.applyPreset();
    const geos = await prisma.schoolSubject.findMany({ where: { classId: c7.id, nameKey: 'геометрия' } });
    check(preset.created > 0 && geos.length === 1 && geos[0].id === geo.id,
      `пресет: ручная «геометрия» опознана по ключу — второй «Геометрии» нет (создано ${preset.created}, пропущено ${preset.skipped})`);
    const again = await subjects.applyPreset();
    check(again.created === 0, 'пресет: повторный прогон — ноль карточек');
  });

  // ---------- 5. слияние на стенде ----------
  const ready = await readySchool(b, 'Школа слияния');
  const ws = ready.workspaceId;
  const teacher2 = await makeStaff(b, ready, ['teacher'], 'Сидорова Ольга');
  const teacher3 = await makeStaff(b, ready, ['teacher'], 'Кузнецова Ирина');
  await inSchool(ws, async () => {
    const canon = ready.subjectId; // «Математика», педагог Иванова классом, 8 ч/нед, уроки материализованы
    // вторая классовая привязка канону — чтобы канон и дубль сравнялись по привязкам и правило дошло до уроков
    await prisma.teacherBinding.create({ data: { workspaceId: ws, subjectId: canon, teacherId: teacher3.userId, scope: 'class', groupNos: [] } });
    // дубль — как его оставил импорт: строчными, тем же классом; priority — у дубля
    const dup = await prisma.schoolSubject.create({
      data: { workspaceId: ws, name: 'математика', nameKey: 'математика', classId: ready.classId, priority: true },
    });
    await prisma.teacherBinding.create({
      data: { workspaceId: ws, subjectId: dup.id, teacherId: ready.teacher.userId, scope: 'class', groupNos: [], hoursPerYear: 2 * 34, hoursPerWeek: 2 },
    });
    await prisma.teacherBinding.create({
      data: { workspaceId: ws, subjectId: dup.id, teacherId: teacher2.userId, scope: 'class', groupNos: [], hoursPerYear: 3 * 34, hoursPerWeek: 3 },
    });
    // один урок, его слот сетки и колонка журнала «принадлежат» дублю; в уроке — отметка
    const lesson = await prisma.schoolLesson.findFirst({ where: { workspaceId: ws, subjectId: canon, detachedAt: null }, orderBy: { date: 'asc' } });
    if (!lesson) throw new Error('стенд: уроков нет — readySchool не материализовал сетку');
    const slot = await prisma.templateSlot.findFirst({
      where: { templateId: ready.templateId, dayNo: dowOf(lesson.date), slotNo: lesson.slotNo, classId: ready.classId, groupNo: 0 },
    });
    if (!slot) throw new Error('стенд: слот шаблона для урока не найден');
    await prisma.templateSlot.update({ where: { id: slot.id }, data: { subjectId: dup.id } });
    await prisma.schoolLesson.update({ where: { id: lesson.id }, data: { subjectId: dup.id } });
    await prisma.journalColumn.updateMany({ where: { lessonId: lesson.id }, data: { subjectId: dup.id } });
    const row = await prisma.journalRow.findFirst({ where: { classId: ready.classId } });
    if (!row) throw new Error('стенд: строк журнала нет — проекция не догнала контингент');
    await prisma.mark.create({ data: { workspaceId: ws, lessonId: lesson.id, studentId: row.studentId, value: '5', postedBy: ready.teacher.userId } });
    await prisma.activationToken.create({
      data: { workspaceId: ws, token: `g85-${Date.now()}`, purpose: 'subject_bind', targetId: dup.id, roles: [], expiresAt: new Date(Date.now() + 300_000) },
    });
    const versionBefore = (await prisma.schoolState.findUnique({ where: { workspaceId: ws } }))?.scheduleVersion ?? -1;

    // правило выбора канона
    const groups = await findDuplicateGroups(prisma, ws);
    const g = groups.find((x) => x.classId === ready.classId && x.nameKey === 'математика');
    check(groups.length === 1 && g?.canon.id === canon && g.dups.length === 1 && g.dups[0].id === dup.id,
      'поиск дублей: одна пара «Математика»/«математика»; при равных привязках канон — карточка с уроками');

    // dry-run: план есть, записей нет
    const dry = await mergeSubjectPair(prisma, ws, canon, dup.id, { dryRun: true });
    const p = dry.plan;
    check(dry.ok && !dry.applied && p?.bindingsMoved === 1 && p.bindingsDeduped === 1 && p.slots === 1 && p.lessons === 1 && p.columns === 1 && p.tokens === 1,
      'dry-run: план — 1 привязка переезжает, 1 сливается, слот/урок/колонка/токен по одному');
    check(p?.canonName === 'Математика' && p.priority === true && p.hours.length === 1,
      'dry-run: имя канона «Математика», priority — ИЛИ (от дубля), расхождение часов напечатано');
    const stillTwo = await prisma.schoolSubject.count({ where: { classId: ready.classId } });
    const lessonStill = await prisma.schoolLesson.findUnique({ where: { id: lesson.id } });
    const versionDry = (await prisma.schoolState.findUnique({ where: { workspaceId: ws } }))?.scheduleVersion;
    check(stillTwo === 2 && lessonStill?.subjectId === dup.id && versionDry === versionBefore, 'dry-run ничего не записал: две карточки, урок у дубля, версия та же');

    // apply
    const done = await mergeSubjectPair(prisma, ws, canon, dup.id, { dryRun: false });
    check(done.ok && done.applied, 'apply: пара слита');
    const cards = await prisma.schoolSubject.findMany({ where: { classId: ready.classId } });
    check(cards.length === 1 && cards[0].id === canon && cards[0].name === 'Математика' && cards[0].nameKey === 'математика' && cards[0].priority,
      'после слияния одна карточка — канон с каноническим именем и priority');
    const bindings = await prisma.teacherBinding.findMany({ where: { subjectId: canon } });
    const t1 = bindings.filter((x) => x.teacherId === ready.teacher.userId);
    check(bindings.length === 3 && t1.length === 1 && t1[0].hoursPerYear === 8 * 34 && t1[0].hoursPerWeek === weeklyOfYear(8 * 34),
      'привязки: три (Иванова, Кузнецова, Сидорова); одинаковые Ивановой слиты, часы — максимум 272 ч/год');
    check(bindings.some((x) => x.teacherId === teacher2.userId && x.hoursPerYear === 3 * 34), 'привязка Сидоровой переехала на канон с часами');
    const [dupSlots, dupLessons, dupCols, dupTokens] = await Promise.all([
      prisma.templateSlot.count({ where: { workspaceId: ws, subjectId: dup.id } }),
      prisma.schoolLesson.count({ where: { workspaceId: ws, subjectId: dup.id } }),
      prisma.journalColumn.count({ where: { workspaceId: ws, subjectId: dup.id } }),
      prisma.activationToken.count({ where: { workspaceId: ws, targetId: dup.id } }),
    ]);
    check(dupSlots + dupLessons + dupCols + dupTokens === 0, 'ссылок на дубль не осталось: слоты, уроки, колонки журнала, токены');
    const mark = await prisma.mark.findFirst({ where: { lessonId: lesson.id } });
    const col = await prisma.journalColumn.findUnique({ where: { lessonId: lesson.id } });
    check(mark?.value === '5' && col?.subjectId === canon, 'отметка на месте, колонка её урока — у канона');
    const versionAfter = (await prisma.schoolState.findUnique({ where: { workspaceId: ws } }))?.scheduleVersion;
    check(versionAfter === versionBefore + 1, 'версия сетки поднята на единицу');
    // ключ урока сходится со слотом — следующий confirm не отвяжет ни одного урока
    const slots = await prisma.templateSlot.findMany({ where: { templateId: ready.templateId } });
    const keys = new Set(slots.map((s) => lessonKey(s.dayNo, s.slotNo, s.classId, s.groupNo, s.subjectId)));
    const live = await prisma.schoolLesson.findMany({ where: { workspaceId: ws, detachedAt: null } });
    const orphan = live.filter((l) => !keys.has(lessonKey(dowOf(l.date), l.slotNo, l.classId, l.groupNo, l.subjectId)));
    check(live.length > 0 && orphan.length === 0, `ключ урока сходится со слотом у всех ${live.length} уроков — отвязок при следующем confirm не будет`);
    check((await subjects.list()).filter((s) => s.classId === ready.classId).length === 1, 'API отдаёт одну карточку класса');
    const second = await mergeSubjectPair(prisma, ws, canon, dup.id, { dryRun: true });
    check(!second.ok, 'повторное слияние той же пары — пропуск (дубль уже удалён)');

    // ---------- 6. Д6-конфликт между дублями ----------
    const c2 = await prisma.schoolClass.create({ data: { workspaceId: ws, parallel: 2, letter: null, label: '2', groupCount: 2 } });
    const eng1 = await subjects.create({ name: 'Иностранный язык', classId: c2.id });
    await prisma.teacherBinding.create({ data: { workspaceId: ws, subjectId: eng1.id, teacherId: ready.teacher.userId, scope: 'class', groupNos: [] } });
    const eng2 = await prisma.schoolSubject.create({ data: { workspaceId: ws, name: 'иностранный  язык', nameKey: 'иностранный язык', classId: c2.id } });
    await prisma.teacherBinding.create({ data: { workspaceId: ws, subjectId: eng2.id, teacherId: teacher2.userId, scope: 'group', groupNos: [1] } });
    const d6 = await mergeSubjectPair(prisma, ws, eng1.id, eng2.id, { dryRun: false });
    check(!d6.ok && !d6.applied && (d6.skipped ?? '').includes('Д6'), `Д6-конфликт класс↔группы: пара пропущена — «${d6.skipped}»`);
    check((await prisma.schoolSubject.count({ where: { classId: c2.id } })) === 2, 'Д6: обе карточки целы — решает человек');
    await TenantContext.runAsSystem(() => b.outbox.drain());
  });

  await b.close();
  return report('G-85 · КЛЮЧ ИМЕНИ ПРЕДМЕТА И СЛИЯНИЕ ДУБЛЕЙ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
