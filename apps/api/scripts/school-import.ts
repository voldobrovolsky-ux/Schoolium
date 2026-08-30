/**
 * Импорт данных школы из JSON (событие 30.08, ранбук §1.2) — ПЛАТФОРМЕННАЯ
 * операция, экрана у неё нет: разовая заливка того, что модератор иначе вводил
 * бы с экранов весь день. Идёт ЧЕРЕЗ ТЕ ЖЕ сервисы, что и экраны, — ни одной
 * прямой вставки в таблицы контингента: инварианты (события, версии, лимиты)
 * работают как в проде.
 *
 * Формат данных — school-data.json из конвертера владельца (в git НЕ лежит:
 * в нём ПДн). Санминимум АР-155: ФИО, класс, связи родитель→ребёнок; даты
 * рождения, договоры и суммы в JSON не попадают уже на конвертере.
 *
 *   npm --workspace apps/api run school:import -- --workspace=<id> --data=./school-data.json
 *   … --include-disputed   — заводить и строки, помеченные спорными
 *   … --dry-run            — посчитать и показать, ничего не писать
 *
 * Креды всех заведённых учёток пишутся в school-import-creds.txt рядом с
 * данными (chmod 600) — показываются один раз, дальше только перевыпуск с
 * карточек.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox.dispatcher';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { CalendarService } from '../src/schoolium/calendar/calendar.service';
import { ScheduleService } from '../src/schoolium/schedule/schedule.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { AccountsService } from '../src/schoolium/access/accounts.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import type { SchoolActor } from '../src/schoolium/actor';
import type { SchoolRole, Sex, TermDto } from '@edustore/shared';

interface ImpStudent {
  row: number;
  lastName: string;
  firstName: string;
  middleName: string;
  class: number;
  disputed: string | null;
}
interface ImpData {
  terms: { no: 1 | 2 | 3 | 4; start: string; end: string }[];
  classes: { parallel: number; students: ImpStudent[] }[];
  guardians: { lastName: string; firstName: string; middleName: string; phone: string | null; children: { class: number; row: number }[] }[];
  staff: { fio: string }[];
  subjects: { class: number; name: string; hours: number; teachers: string[] }[];
  timetable?: {
    days: number;
    slotsPerDay: number;
    lessonMin: number;
    breakMin: number;
    bigBreakAfter: number;
    bigBreakMin: number;
    slots: { class: number; day: number; slot: number; subject: string; teacher: string | null }[];
  };
}

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? '' : undefined;
};

/**
 * Пол — из отчества (-вна/-ична → f, -вич/-ич → m), иначе из окончания имени.
 * Механическая эвристика, а не факт: сомнительные случаи перечисляются в
 * отчёте, модератор правит с экрана `S-13`.
 */
const FEM_NAMES = new Set(['любовь', 'нинель', 'николь', 'эстер', 'рахиль']);
const MASC_A = new Set(['никита', 'данила', 'илья', 'кузьма', 'фома', 'лука', 'савва', 'гордей']);
function guessSex(s: ImpStudent, unsure: string[]): Sex {
  const m = s.middleName.toLowerCase();
  if (/(вна|чна|шна)$/.test(m)) return 'f';
  if (/(вич|ич|глы|лы)$/.test(m)) return 'm';
  const n = s.firstName.toLowerCase();
  if (MASC_A.has(n)) return 'm';
  if (FEM_NAMES.has(n) || /[ая]$/.test(n)) return 'f';
  if (!m) unsure.push(`${s.lastName} ${s.firstName} (${s.class} кл) — пол определён как «м» по имени без отчества`);
  return 'm';
}

async function main(): Promise<void> {
  const dataPath = arg('data') ?? './school-data.json';
  const workspaceId = arg('workspace');
  const includeDisputed = arg('include-disputed') !== undefined;
  const dryRun = arg('dry-run') !== undefined;
  if (!workspaceId) {
    console.error('нужен --workspace=<id> (печатает school:bootstrap)');
    process.exit(2);
  }
  const data: ImpData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const outbox = app.get(OutboxDispatcher);
  const contingent = app.get(ContingentService);
  const subjects = app.get(SubjectsService);
  const calendar = app.get(CalendarService);
  const schedule = app.get(ScheduleService);
  const staff = app.get(StaffService);
  const accounts = app.get(AccountsService);
  const state = app.get(SchoolStateService);
  const drain = () => TenantContext.runAsSystem(() => outbox.drain());

  const ws = await TenantContext.runAsSystem(() => prisma.workspace.findUnique({ where: { id: workspaceId } }));
  if (!ws) {
    console.error(`workspace ${workspaceId} не найден`);
    process.exit(3);
  }
  const opMembership = await TenantContext.runAsSystem(() =>
    prisma.membership.findFirst({ where: { workspaceId, roles: { has: 'admin' } } }),
  );
  if (!opMembership?.userId) {
    console.error('в школе нет оператора с ролью admin — сначала school:bootstrap');
    process.exit(3);
  }
  const operator = await TenantContext.runAsSystem(() => prisma.user.findUnique({ where: { id: opMembership.userId! } }));
  const actor: SchoolActor = {
    userId: opMembership.userId,
    workspaceId,
    roles: opMembership.roles as SchoolRole[],
    name: operator?.displayName ?? 'оператор',
  };

  const unsure: string[] = [];
  const skipped: string[] = [];
  const creds: string[] = [];
  const rosterOf = (p: { students: ImpStudent[] }) =>
    p.students.filter((s) => includeDisputed || !s.disputed);
  for (const p of data.classes) {
    for (const s of p.students) {
      if (s.disputed && !includeDisputed) skipped.push(`${s.lastName} ${s.firstName} (${s.class} кл): ${s.disputed}`);
    }
  }

  const plan = {
    classes: data.classes.length,
    students: data.classes.reduce((n, p) => n + rosterOf(p).length, 0),
    guardians: data.guardians.length,
    staff: data.staff.length,
    subjects: data.subjects.length,
  };
  console.log(`Школа: ${ws.name} · классов ${plan.classes}, учеников ${plan.students}, родителей ${plan.guardians}, персонала ${plan.staff}, предметных строк ${plan.subjects}`);
  if (dryRun) {
    console.log(`Спорные (пропущены): ${skipped.length}`);
    skipped.forEach((s) => console.log('  - ' + s));
    await app.close();
    return;
  }

  await TenantContext.run({ tenantId: workspaceId, system: false }, async () => {
    // ─── четверти из учебного календаря школы ───
    await calendar.setTerms(
      data.terms.map((t): TermDto => ({ termNo: t.no, dateFrom: t.start, dateTo: t.end })),
      actor,
    );
    await drain();
    console.log(`Четверти: ${data.terms.map((t) => `${t.start}…${t.end}`).join(' · ')}`);

    // ─── классы мастером: поклассные численности и пол из списков ───
    const sexed = data.classes.map((p) => {
      const roster = rosterOf(p).map((s) => ({ ...s, sex: guessSex(s, unsure) }));
      return { parallel: p.parallel, roster, boys: roster.filter((s) => s.sex === 'm').length };
    });
    await contingent.createClasses(
      {
        parallels: Math.max(...sexed.map((c) => c.parallel)),
        letters: null,
        studentsPerClass: 1,
        groups: null,
        sexKind: 'boys',
        sexCount: 0,
        perClass: sexed.map((c) => ({ label: String(c.parallel), students: Math.max(c.roster.length, 1), sexCount: c.boys })),
        version: 0,
      },
      actor,
    );
    await drain();
    const classes = await contingent.listClasses();
    const classByParallel = new Map(classes.map((c) => [c.parallel, c]));

    // ─── профили: плейсхолдеры лежат «мальчики, потом девочки» — заполняем тем же порядком ───
    const studentIdByRow = new Map<number, string>();
    for (const c of sexed) {
      const cls = classByParallel.get(c.parallel);
      if (!cls) continue;
      const placeholders = await contingent.listStudents(cls.id);
      const ordered = [...c.roster.filter((s) => s.sex === 'm'), ...c.roster.filter((s) => s.sex === 'f')];
      for (let i = 0; i < ordered.length; i += 1) {
        const src = ordered[i];
        const slot = placeholders[i];
        if (!slot) break;
        const saved = await contingent.updateStudent(
          slot.id,
          { lastName: src.lastName, firstName: src.firstName, middleName: src.middleName || null, sex: src.sex },
          actor,
        );
        studentIdByRow.set(src.row, saved.id);
      }
    }
    await drain();
    console.log(`Ученики заведены: ${studentIdByRow.size}`);

    // ─── учётки учеников: именной QR на событии показывается только заведённой учётке ───
    for (const [row, sid] of studentIdByRow) {
      const r = await accounts.createStudentAccess(sid, {});
      const st = data.classes.flatMap((p) => p.students).find((s) => s.row === row);
      creds.push(`ученик\t${st?.class} кл\t${st?.lastName} ${st?.firstName}\t${r.credentials.username}\t${r.credentials.password}`);
    }
    console.log(`Учётки учеников: ${studentIdByRow.size}`);

    // ─── персонал: карточка = полная учётка (АР-161), креды печатаются один раз ───
    const teacherByFio = new Map<string, string>();
    for (const t of data.staff) {
      const [lastName, ...initials] = t.fio.split(/\s+/);
      const [fi = '', mi = ''] = (initials.join(' ').match(/[А-ЯЁ]\.?/g) ?? []).map((x) => x.replace(/\.?$/, '.'));
      const r = await staff.addCard({ role: 'teacher', lastName, firstName: fi || '—', middleName: mi || null });
      teacherByFio.set(t.fio, r.card.userId!);
      creds.push(`педагог\t\t${t.fio}\t${r.credentials.username}\t${r.credentials.password}`);
    }
    await drain();
    console.log(`Персонал: ${teacherByFio.size} (имена — фамилия + инициалы, дополнит модератор)`);

    // ─── предметы и привязки: тот же токен-маршрут, что у QR на экране ───
    let bound = 0;
    const bindingHours = new Map<string, number>();
    const subjIdByClassName = new Map<string, string>();
    for (const row of data.subjects) {
      const cls = classByParallel.get(row.class);
      if (!cls) continue;
      const subj = await subjects.create({ name: row.name, classId: cls.id });
      subjIdByClassName.set(`${row.class}·${row.name}`, subj.id);
      for (const fio of row.teachers) {
        const teacherId = teacherByFio.get(fio);
        if (!teacherId) continue;
        const tok = await subjects.createBindToken(subj.id);
        await subjects.scan(tok.token, { userId: teacherId, workspaceId, roles: ['teacher'], name: fio });
        await subjects.bindTeacher(subj.id, { token: tok.token, scope: 'class' }, actor);
        bound += 1;
      }
      bindingHours.set(`${subj.id}`, row.hours);
    }
    await drain();
    console.log(`Предметы: ${data.subjects.length}, привязок педагогов: ${bound}`);

    // ─── недельные часы из штатки — в нагрузку генератора (сетку соберут после события) ───
    // План этой школы (40 ач/нед полного дня: самоподготовка, лежачие занятия)
    // не влезает в потолок СанПиН для генератора — ворота нагрузки правы для
    // своей модели, и импорт их НЕ ослабляет: часы просто не проставляются, а
    // завуч распределит академическую часть при сборке сетки после события.
    try {
      const load = await schedule.load();
      const entries = load.entries.map((e) => ({
        bindingId: e.bindingId,
        hoursPerWeek: bindingHours.get(e.subjectId) ?? e.hoursPerWeek ?? 1,
      }));
      if (entries.length > 0) {
        await schedule.setLoad({ entries, version: load.version }, actor);
        console.log(`Нагрузка проставлена: ${entries.length} строк`);
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'LOAD_EXCEEDS_SANPIN') throw e;
      console.log('Нагрузка НЕ проставлена: недельный план школы выше потолка СанПиН генератора — часы распределит завуч при сборке сетки');
    }
    await drain();

    // ─── родители: карточка + связи, тем же сервисом, что S-14 ───
    let links = 0;
    for (const g of data.guardians) {
      const kids = g.children.map((k) => studentIdByRow.get(k.row)).filter((x): x is string => Boolean(x));
      if (kids.length === 0) {
        skipped.push(`родитель ${g.lastName} ${g.firstName}: все дети спорные/не заведены`);
        continue;
      }
      const r = await accounts.createGuardian({
        lastName: g.lastName,
        firstName: g.firstName,
        middleName: g.middleName || null,
        studentIds: kids,
      });
      links += kids.length;
      creds.push(`родитель\t${g.phone ?? ''}\t${g.lastName} ${g.firstName} ${g.middleName}\t${r.credentials.username}\t${r.credentials.password}`);
    }
    await drain();
    console.log(`Родители: заведены, связей с детьми: ${links}`);

    // ─── ручная сетка школы (правка владельца 2026-08-30: «перенеси расписание сразу») ───
    // Шаблон вставляется напрямую (сервиса ручной сетки нет — генератор её бы
    // пересобрал по-своему), а ПОДТВЕРЖДЕНИЕ идёт через штатный confirm: уроки,
    // колонки журнала и события материализуются тем же путём, что у генератора.
    if (data.timetable) {
      const tt = data.timetable;
      const skippedSlots: string[] = [];
      const rows: { dayNo: number; slotNo: number; classId: string; subjectId: string; teacherId: string }[] = [];
      for (const s of tt.slots) {
        const cls = classByParallel.get(s.class);
        const subjectId = subjIdByClassName.get(`${s.class}·${s.subject}`);
        const teacherId = s.teacher ? teacherByFio.get(s.teacher) : undefined;
        if (!cls || !subjectId || !teacherId) {
          skippedSlots.push(`${s.class} кл · день ${s.day + 1} · слот ${s.slot} · ${s.subject}${s.teacher ? '' : ' (вакансия)'}`);
          continue;
        }
        rows.push({ dayNo: s.day, slotNo: s.slot, classId: cls.id, subjectId, teacherId });
      }
      const tpl = await prisma.scheduleTemplate.create({
        data: {
          workspaceId,
          status: 'draft',
          seed: 0,
          days: tt.days,
          slotsPerDay: tt.slotsPerDay,
          lessonMin: tt.lessonMin,
          breakMin: tt.breakMin,
          bigBreakAfter: tt.bigBreakAfter,
          bigBreakMin: tt.bigBreakMin,
          dayStartMin: 540, // 9:00 — реальное начало уроков школы

          slots: { create: rows.map((r) => ({ ...r, workspaceId, groupNo: 0 })) },
        },
      });
      const reg = await state.register();
      await schedule.confirm({ templateId: tpl.id, version: reg.scheduleVersion }, actor);
      await drain();
      console.log(`Сетка перенесена: ${rows.length} уроков в неделю, подтверждена штатным confirm`);
      if (skippedSlots.length) {
        console.log(`Слоты без предмета/педагога — НЕ перенесены (${skippedSlots.length}), добавит завуч с экрана:`);
        skippedSlots.forEach((x) => console.log('  - ' + x));
      }
    }
  });

  const credsPath = path.join(path.dirname(dataPath), 'school-import-creds.txt');
  fs.writeFileSync(credsPath, ['роль\tкласс/телефон\tФИО\tюзернейм\tпароль', ...creds].join('\n'), { mode: 0o600 });
  console.log(`\nКреды (${creds.length}) записаны в ${credsPath} — показаны один раз, дальше перевыпуск с карточек.`);
  if (skipped.length) {
    console.log(`\nПропущено (спорные, вопрос владельцу; добавляются --include-disputed или с экранов):`);
    skipped.forEach((s) => console.log('  - ' + s));
  }
  if (unsure.length) {
    console.log(`\nПол определён эвристикой — проверить на S-13:`);
    unsure.forEach((s) => console.log('  - ' + s));
  }
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
