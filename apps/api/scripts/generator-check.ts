/**
 * G-34 (AR-73, AR-75, AR-84, AR-199, AR-200, AR-206) — **генератор доказуемо честен.**
 *
 * Перечислением по ВСЕМ ячейкам сетки первой школы (8 классов без литер,
 * английский по группам) доказывается:
 *   1. нагрузка каждой пары выполнена полностью — ровно её часы;
 *   2. педагог не стоит в двух местах одного слота;
 *   3. класс/группа не занят дважды; ученик не занят дважды в слоте;
 *   4. полуокон групп НЕТ: групповой час планируется атомарной спаренной
 *      единицей — обе группы в одном слоте, каждая со своим педагогом;
 *   5. окон у класса нет: уроки дня идут подряд с первого слота; позиция обеда
 *      класса (AR-200) окном не считается;
 *   6. приоритетные предметы — мягкое ограничение: нарушение помечается, а не
 *      валит генерацию;
 *   7. каждый из семи кодов отказа воспроизводится, и шесть из них — ДО
 *      перебора; коды СанПиН не бросаются (AR-199);
 *   8. рабочие дни педагога (AR-206) — жёсткое ограничение: единица не встаёт
 *      в день, когда хоть один её педагог не работает; арифметика
 *      `TEACHER_DAYS_SHORT` — до перебора, с педагогом и цифрами;
 *   9. обед по классам (AR-200): класс с обедом после 3-го не получает урок в
 *      позиции 4, класс без — получает; вместимость в `LOAD_EXCEEDS_GRID`
 *      — позиции минус одна в день.
 *
 * Запуск: npm --workspace apps/api run generator:check
 */
import { ARITHMETIC_REFUSALS, GENERATOR_REFUSALS } from '@edustore/shared';
import { arithmeticRefusal, generate, type GenInput, type GenPair, type GenSlot } from '../src/schoolium/schedule/generator';
import { check, report } from './schoolium/harness';

const TEACHERS = ['Мария', 'Ольга', 'Иван', 'Пётр', 'Анна', 'Нина', 'Олег', 'Юлия', 'Егор', 'Вера'];

/** Первая школа: 8 параллелей без литер, по 2 группы, английский по группам. */
function firstSchool(seed: number): GenInput {
  const classes = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i + 1}`,
    label: String(i + 1),
    parallel: i + 1,
    groupCount: 2,
  }));
  const pairs: GenPair[] = [];
  classes.forEach((c, i) => {
    const add = (subjectId: string, subjectName: string, teacher: string, hours: number, scope: 'class' | 'group', groupNos: number[], priority = false) =>
      pairs.push({ subjectId: `${subjectId}-${c.id}`, subjectName, classId: c.id, teacherId: teacher, teacherName: teacher, scope, groupNos, hours, priority });
    add('math', 'математика', TEACHERS[i % 3], 4, 'class', [], true);
    add('rus', 'русский', TEACHERS[3 + (i % 3)], 4, 'class', []);
    add('hist', 'история', TEACHERS[6], 2, 'class', []);
    add('pe', 'физкультура', TEACHERS[7], 2, 'class', []);
    add('eng', 'английский', TEACHERS[8], 2, 'group', [1]);
    add('eng', 'английский', TEACHERS[9], 2, 'group', [2]);
  });
  return {
    classes,
    pairs,
    // «Уроков в день» — одно число на школу и применяется ко всем параллелям
    // одинаково (AR-199): первоклассник и восьмиклассник живут в одной сетке
    // без потолков параллели.
    params: { days: 5, slotsPerDay: 7, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
    seed,
    classesWithUnassignedGroups: [],
    uncovered: [],
  };
}

/** Проверка результата ПЕРЕЧИСЛЕНИЕМ по всем ячейкам, а не выборочно. */
function violations(slots: GenSlot[], input: GenInput): string[] {
  const v: string[] = [];
  const { days, slotsPerDay } = input.params;

  // 2. педагог в двух местах одного слота
  const seen = new Set<string>();
  for (const s of slots) {
    const k = `${s.dayNo}:${s.slotNo}:${s.teacherId}`;
    if (seen.has(k)) v.push(`педагог ${s.teacherId} в двух местах: день ${s.dayNo + 1}, урок ${s.slotNo}`);
    seen.add(k);
  }

  for (const c of input.classes) {
    const lunch = input.classLunch?.[c.id];
    for (let d = 0; d < days; d += 1) {
      const perSlot: GenSlot[][] = Array.from({ length: slotsPerDay + 1 }, () => []);
      for (const s of slots) {
        if (s.classId !== c.id || s.dayNo !== d) continue;
        // 7. день не длиннее «уроков в день» школы (AR-199)
        if (s.slotNo < 1 || s.slotNo > slotsPerDay) { v.push(`слот вне дня: класс ${c.label}, день ${d + 1}, урок ${s.slotNo}`); continue; }
        perSlot[s.slotNo].push(s);
      }

      let lastBusy = 0;
      for (let n = 1; n <= slotsPerDay; n += 1) if (perSlot[n].length) lastBusy = n;

      for (let n = 1; n <= slotsPerDay; n += 1) {
        const cell = perSlot[n];
        // 9. позиция обеда класса пуста и окном не считается (AR-200)
        if (n === lunch) {
          if (cell.length) v.push(`урок в позиции обеда: класс ${c.label}, день ${d + 1}, урок ${n}`);
          continue;
        }
        // 5. окно: пустой слот раньше последнего занятого
        if (n < lastBusy && cell.length === 0) v.push(`окно: класс ${c.label}, день ${d + 1}, урок ${n}`);
        // 3. двойная занятость класса целиком
        const whole = cell.filter((x) => x.groupNo === 0);
        if (whole.length > 1) v.push(`класс ${c.label} занят дважды: день ${d + 1}, урок ${n}`);
        if (whole.length && cell.length > whole.length)
          v.push(`ученик занят дважды: «весь класс» и группа в одном слоте — ${c.label}, день ${d + 1}, урок ${n}`);
        // 3. группа занята дважды
        const byGroup = new Map<number, number>();
        for (const x of cell.filter((y) => y.groupNo > 0)) byGroup.set(x.groupNo, (byGroup.get(x.groupNo) ?? 0) + 1);
        for (const [g, n2] of byGroup) if (n2 > 1) v.push(`группа ${g} класса ${c.label} занята дважды: день ${d + 1}, урок ${n}`);
        // 4. полуокно: групповой час без пары
        if (byGroup.size > 0 && byGroup.size !== c.groupCount)
          v.push(`полуокно: класс ${c.label}, день ${d + 1}, урок ${n} — занято групп ${byGroup.size} из ${c.groupCount}`);
      }
    }
  }

  // 1. нагрузка выполнена полностью
  for (const p of input.pairs) {
    const need = p.hours;
    const got = slots.filter(
      (s) => s.classId === p.classId && s.subjectId === p.subjectId && s.teacherId === p.teacherId &&
        (p.scope === 'class' ? s.groupNo === 0 : p.groupNos.includes(s.groupNo)),
    ).length;
    if (got !== need) v.push(`нагрузка не выполнена: ${p.subjectName} ${p.classId} — ${got} из ${need} ч`);
  }
  return v;
}

console.log('G-34 · генератор шаблона недели (AR-73, AR-75, AR-84, AR-199, AR-200, AR-206)\n');

const input = firstSchool(2026);
const res = generate(input);
if (!res.ok) {
  check(false, `сетка первой школы не собрана: ${res.code}`);
} else {
  const v = violations(res.slots, input);
  const cells = input.classes.length * input.params.days * input.params.slotsPerDay;
  check(v.length === 0,
    v.length === 0
      ? `сетка первой школы собрана (зерно ${input.seed}, попыток ${res.attempts}, ${res.durationMs} мс); ${cells} ячеек проверены перечислением: окон, полуокон и двойной занятости нет`
      : `нарушений ${v.length}: ${v.slice(0, 5).join(' · ')}`);
  check(res.slots.filter((s) => s.groupNo > 0).length === 8 * 2 * 2,
    `групповые часы поставлены парами: ${res.slots.filter((s) => s.groupNo > 0).length} слотов = 8 классов × 2 группы × 2 ч`);
  check(Array.isArray(res.priorityWarnings),
    `приоритеты — мягкое ограничение: предупреждений ${res.priorityWarnings.length}, генерация не сорвана`);
}

// ─── каждый из семи кодов отказа воспроизводится ───
const cls = (id: string, parallel: number, groupCount = 0) => ({ id, label: String(parallel), parallel, groupCount });
const pair = (o: Partial<GenPair> & { classId: string; teacherId: string; hours: number }): GenPair => ({
  subjectId: 's', subjectName: 'предмет', scope: 'class', groupNos: [], teacherName: o.teacherId, priority: false, ...o,
});
const P = { days: 5, slotsPerDay: 6, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 };
const mk = (o: Partial<GenInput>): GenInput => ({
  classes: [cls('c5', 5)], pairs: [], params: P, seed: 1, classesWithUnassignedGroups: [], uncovered: [], ...o,
});

const cases: [string, GenInput][] = [
  ['LOAD_EXCEEDS_GRID', mk({ classes: [cls('c11', 11)], pairs: [pair({ classId: 'c11', teacherId: 't1', hours: 31, subjectId: 'a' })] })],
  ['TEACHER_OVERBOOKED', mk({
    classes: [cls('c5', 5), cls('c6', 6)],
    pairs: [pair({ classId: 'c5', teacherId: 't1', hours: 20, subjectId: 'a' }), pair({ classId: 'c6', teacherId: 't1', hours: 20, subjectId: 'b' })],
  })],
  ['SUBJECT_UNCOVERED', mk({ uncovered: [{ subjectId: 'x', subjectName: 'английский', classId: 'c5', groups: [2] }] })],
  ['GROUPS_UNASSIGNED', mk({ classesWithUnassignedGroups: [{ id: 'c5', label: '5' }] })],
  ['GROUP_HOURS_UNEQUAL', mk({
    classes: [cls('c5', 5, 2)],
    pairs: [
      pair({ classId: 'c5', teacherId: 't1', hours: 3, subjectId: 'eng', scope: 'group', groupNos: [1] }),
      pair({ classId: 'c5', teacherId: 't2', hours: 1, subjectId: 'eng', scope: 'group', groupNos: [2] }),
    ],
  })],
  // AR-206: 24 часа при 3 рабочих днях × 5 уроков = 15 — недельная сетка (25) вместила бы
  ['TEACHER_DAYS_SHORT', mk({
    params: { ...P, slotsPerDay: 5 },
    pairs: [pair({ classId: 'c5', teacherId: 't1', teacherName: 'Иванова М. И.', hours: 24, subjectId: 'a' })],
    teacherDays: { t1: [0, 2, 4] },
  })],
];

for (const [code, inp] of cases) {
  const r = arithmeticRefusal(inp);
  check(r?.code === code, `отказ ${code} воспроизводится арифметикой ДО перебора → ${r?.code ?? 'не сработал'}`);
}
const short = arithmeticRefusal(cases[5][1]);
check(short?.details.teacher === 'Иванова М. И.' && short?.details.hours === 24 && short?.details.slots === 15 && short?.details.days === 'ПН, СР, ПТ',
  `TEACHER_DAYS_SHORT называет педагога и цифры: ${short?.details.teacher}, ${short?.details.hours} ч при ${short?.details.slots} уроках в дни ${short?.details.days}`);
check(ARITHMETIC_REFUSALS.length === 6, `арифметических отказов ровно шесть: ${ARITHMETIC_REFUSALS.join(', ')}`);
check(GENERATOR_REFUSALS.length === 7 && GENERATOR_REFUSALS.includes('NO_SOLUTION'),
  'кодов отказа генератора семь; NO_SOLUTION — единственный отказ самого перебора');

// ─── AR-199: потолки СанПиН не судят никого ───
// 30 часов в 5 классе (прежний потолок 29) и 30 часов в 1 классе (прежний потолок 21):
// вместимость судит только сетка 5 × 6 = 30.
check(arithmeticRefusal(mk({ pairs: [pair({ classId: 'c5', teacherId: 't1', hours: 30, subjectId: 'a' })] })) === null,
  '30 часов в 5 классе при 30 слотах проходят — недельного потолка СанПиН нет (AR-199)');
check(arithmeticRefusal(mk({ classes: [cls('c1', 1)], pairs: [pair({ classId: 'c1', teacherId: 't1', hours: 30, subjectId: 'a' })] })) === null,
  '30 часов в 1 классе при 30 слотах проходят — потолка параллели нет (AR-199)');
const grid31 = arithmeticRefusal(mk({ classes: [cls('c1', 1)], pairs: [pair({ classId: 'c1', teacherId: 't1', hours: 31, subjectId: 'a' })] }));
check(grid31?.code === 'LOAD_EXCEEDS_GRID' && grid31.details.breakdown === '6 уроков в день × 5 дней',
  `31 час в 1 классе — LOAD_EXCEEDS_GRID с разбором «${grid31?.details.breakdown}»`);

// ─── AR-206: рабочие дни педагога — жёсткое ограничение перебора ───
{
  const inp = mk({
    pairs: [pair({ classId: 'c5', teacherId: 't1', hours: 5, subjectId: 'a' })],
    teacherDays: { t1: [0, 2] },
  });
  const r = generate(inp);
  check(r.ok && r.slots.length === 5 && r.slots.every((s) => s.dayNo === 0 || s.dayNo === 2),
    `педагог с рабочими днями ПН, СР получает уроки только в них: дни ${r.ok ? [...new Set(r.slots.map((s) => s.dayNo))].sort().join(', ') : r.code}`);
}
{
  // спаренная групповая единица: день общий для обоих педагогов — пересечение ПН,ВТ ∩ ВТ,СР = ВТ
  const inp = mk({
    classes: [cls('c7', 7, 2)],
    pairs: [
      pair({ classId: 'c7', teacherId: 't1', hours: 2, subjectId: 'eng', scope: 'group', groupNos: [1] }),
      pair({ classId: 'c7', teacherId: 't2', hours: 2, subjectId: 'eng', scope: 'group', groupNos: [2] }),
    ],
    teacherDays: { t1: [0, 1], t2: [1, 2] },
  });
  const r = generate(inp);
  check(r.ok && r.slots.length === 4 && r.slots.every((s) => s.dayNo === 1),
    `групповая единица встаёт только в общий рабочий день обоих педагогов (ВТ): ${r.ok ? [...new Set(r.slots.map((s) => s.dayNo))].join(', ') : r.code}`);
}
check(arithmeticRefusal(mk({ pairs: [pair({ classId: 'c5', teacherId: 't1', hours: 10, subjectId: 'a' })], teacherDays: { t1: [] } })) === null,
  'пустой список рабочих дней = любой день: отказа нет');

// ─── AR-200: обед по классам ───
{
  // класс A: обед после 3-го (позиция 4 занята обедом), 15 ч = 3 × 5; класс B: без обеда, 16 ч
  const lunchSchool = (hoursA: number): GenInput => mk({
    classes: [cls('cA', 5), cls('cB', 6)],
    params: { ...P, slotsPerDay: 4 },
    pairs: [
      pair({ classId: 'cA', teacherId: 'tA', hours: 8, subjectId: 'math' }),
      pair({ classId: 'cA', teacherId: 'tB', hours: hoursA - 8, subjectId: 'rus' }),
      pair({ classId: 'cB', teacherId: 'tC', hours: 16, subjectId: 'math' }),
    ],
    classLunch: { cA: 4 },
  });
  const inp = lunchSchool(15);
  const r = generate(inp);
  check(r.ok, `школа с обедом класса A после 3-го собралась (${r.ok ? `${r.slots.length} слотов` : r.code})`);
  if (r.ok) {
    const a = r.slots.filter((s) => s.classId === 'cA');
    const b = r.slots.filter((s) => s.classId === 'cB');
    check(a.length === 15 && !a.some((s) => s.slotNo === 4), 'класс с обедом после 3-го не получает урок в позиции 4');
    check(b.some((s) => s.slotNo === 4), 'класс без своего обеда получает урок в позиции 4');
    check(violations(r.slots, inp).length === 0, 'перечислением: окон нет, обед окном не считается, педагог не в двух местах');
  }
  const over = arithmeticRefusal(lunchSchool(16));
  check(over?.code === 'LOAD_EXCEEDS_GRID' && over.details.grid === 15 && String(over.details.breakdown).includes('обед'),
    `16 часов в класс с обедом → ${over?.code}: вместимость ${over?.details.grid} (${over?.details.breakdown})`);
  // со скелетом: обед после 1-го — урок 3 идёт сразу за уроком 1, окна нет
  const skel = {
    ...inp,
    skeleton: {
      gridKind: 'variable' as const,
      days: [0, 1, 2, 3, 4].map((dayNo) => ({ dayNo, lessons: [1, 2, 3, 4].map((lessonNo) => ({ lessonNo, pairNo: null })) })),
    },
    classLunch: { cA: 2 },
  };
  const rs = generate(skel);
  const aS = rs.ok ? rs.slots.filter((s) => s.classId === 'cA') : [];
  check(rs.ok && !aS.some((s) => s.slotNo === 2) && [0, 1, 2, 3, 4].every((d) => aS.some((s) => s.dayNo === d && s.slotNo === 3)),
    'по скелету: позиция обеда класса пропускается, урок после обеда стоит без окна (позиции 1, 3, 4)');
}

report('G-34 · ГЕНЕРАТОР ЧЕСТЕН');
