/**
 * Общий стенд G-проверок Schoolium 1.1.1.
 *
 * G-проверка = **исполняемое доказательство инварианта**, а не «проверено
 * глазами»: скрипт поднимает реальный Nest-контекст и живой Postgres и
 * ПЕРЕЧИСЛЕНИЕМ показывает, что инвариант держится. Поэтому здесь нет моков —
 * есть настоящая школа, заведённая тем же bootstrap, что и в проде (AR-93).
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { OutboxDispatcher } from '../../src/common/outbox/outbox.dispatcher';
import { TenantContext } from '../../src/common/tenant/tenant-context';
import type { SchoolActor } from '../../src/schoolium/actor';
import type { SchoolRole } from '@edustore/shared';

export interface Bench {
  app: INestApplicationContext;
  prisma: PrismaService;
  outbox: OutboxDispatcher;
  get<T>(t: new (...a: never[]) => T): T;
  close(): Promise<void>;
}

export async function bench(): Promise<Bench> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const outbox = app.get(OutboxDispatcher);
  return {
    app,
    prisma,
    outbox,
    get: (t) => app.get(t as never),
    close: async () => {
      await app.close();
    },
  };
}

export interface School {
  workspaceId: string;
  moderator: SchoolActor;
}

/**
 * Настоящая школа, а не «дефолтная»: `Organization` → `Workspace` → `User` →
 * `Membership` (AR-98). Дефолтной школы в коде нет, и вторая школа — это второй
 * прогон этой функции без единой правки кода.
 */
export async function bootstrapSchool(b: Bench, name: string, phone?: string): Promise<School> {
  return TenantContext.runAsSystem(async () => {
    const org =
      (await b.prisma.organization.findFirst({ where: { type: 'platform' } })) ??
      (await b.prisma.organization.create({ data: { name: 'EduStore', type: 'platform' } }));
    const ws = await b.prisma.workspace.create({ data: { orgId: org.id, name } });
    const id = `u-${randomUUID()}`;
    const user = await b.prisma.user.create({
      data: {
        id,
        phone: phone ?? `+7999${Math.floor(Math.random() * 10_000_000)}`,
        lastName: 'Петрова',
        firstName: 'Анна',
        displayName: 'Петрова А. В.',
      },
    });
    await b.prisma.membership.create({
      // 1.2.0 (AR-148/AR-152): оператор школы из bootstrap несёт ОБЕ роли — полный
      // доступ администратора и КПЦ-рутину модератора; роли совместимы (AR-150)
      data: { florusUserId: user.id, userId: user.id, workspaceId: ws.id, florusRole: 'staff', roles: ['admin', 'moderator'] },
    });
    await b.prisma.staffCard.create({
      data: { workspaceId: ws.id, section: 1, plannedRoles: ['admin', 'moderator'], userId: user.id, seq: 0 },
    });
    await b.prisma.schoolState.create({ data: { workspaceId: ws.id } });
    return {
      workspaceId: ws.id,
      moderator: { userId: user.id, workspaceId: ws.id, roles: ['admin', 'moderator'] as SchoolRole[], name: user.displayName },
    };
  });
}

/** Выполнить сценарий в тенант-контексте школы — как это делает HTTP-запрос. */
export function inSchool<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return TenantContext.run({ tenantId: workspaceId, system: false }, fn);
}

/** Заводит карточку сотрудника и «регистрирует» его — без QR, для сценариев не про вход. */
export async function makeStaff(
  b: Bench,
  school: School,
  roles: SchoolRole[],
  displayName: string,
): Promise<{ userId: string; cardId: string }> {
  return TenantContext.runAsSystem(async () => {
    const id = `u-${randomUUID()}`;
    await b.prisma.user.create({
      data: {
        id,
        phone: `+7999${Math.floor(Math.random() * 10_000_000)}`,
        lastName: displayName.split(' ')[0] ?? displayName,
        firstName: displayName.split(' ')[1] ?? '',
        displayName,
      },
    });
    await b.prisma.membership.create({
      data: { florusUserId: id, userId: id, workspaceId: school.workspaceId, florusRole: 'staff', roles },
    });
    const card = await b.prisma.staffCard.create({
      data: {
        workspaceId: school.workspaceId,
        section: roles.includes('teacher') ? 3 : 1,
        plannedRoles: roles,
        userId: id,
        seq: Math.floor(Math.random() * 1000),
      },
    });
    return { userId: id, cardId: card.id };
  });
}

// ─────────────────────────── протокол вывода ───────────────────────────

let passed = 0;
let failed = 0;

export const ok = (m: string): void => {
  passed += 1;
  console.log(`✓  ${m}`);
};

export const bad = (m: string): void => {
  failed += 1;
  console.log(`✗  ${m}`);
};

export const check = (cond: boolean, m: string): void => (cond ? ok(m) : bad(m));

/** Инвариант доказывается тем, что операция ОТКЛОНЕНА именно этим кодом. */
export async function refuses(fn: () => Promise<unknown>, code: string, m: string): Promise<void> {
  try {
    await fn();
    bad(`${m} — операция прошла, а должна была отклониться кодом ${code}`);
  } catch (e) {
    const body = (e as { response?: { code?: string }; message?: string }).response;
    const actual = body?.code ?? (e as Error).message;
    check(actual === code, `${m} → ${actual}`);
  }
}

export function report(title: string): never {
  console.log(`\n${failed === 0 ? '✓' : '✗'} ${title} — pass=${passed} fail=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

export const counters = () => ({ passed, failed });

// ─────────────────────────── фикстура «работающая школа» ───────────────────────────

import { ContingentService } from '../../src/schoolium/contingent/contingent.service';
import { SubjectsService } from '../../src/schoolium/subjects/subjects.service';
import { CalendarService } from '../../src/schoolium/calendar/calendar.service';
import { ScheduleService } from '../../src/schoolium/schedule/schedule.service';
import { SchoolStateService } from '../../src/schoolium/school-state.service';

/** Дата со сдвигом в днях от сегодняшнего — YYYY-MM-DD. */
export const day = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export interface ReadySchool extends School {
  classId: string;
  subjectId: string;
  teacher: { userId: string; cardId: string };
  studentIds: string[];
  templateId: string;
}

/**
 * Школа, доведённая до `ready` тем же путём, каким её доводит модератор: мастер
 * классов → профили → предметы → персонал → привязки → четверти → нагрузка →
 * приоритеты → параметры дня → генерация → подтверждение. Никаких прямых вставок
 * в таблицы: сценарии проверок должны опираться на то же поведение, что и прод.
 */
export async function readySchool(b: Bench, name = 'Школа приёмки'): Promise<ReadySchool> {
  const contingent = b.get(ContingentService);
  const subjects = b.get(SubjectsService);
  const calendar = b.get(CalendarService);
  const schedule = b.get(ScheduleService);
  const state = b.get(SchoolStateService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  const school = await bootstrapSchool(b, name);
  const teacher = await makeStaff(b, school, ['teacher'], 'Иванова Мария');

  return inSchool(school.workspaceId, async () => {
    await contingent.createClasses(
      { parallels: 1, letters: null, studentsPerClass: 3, groups: null, sexKind: 'boys', sexCount: 2, version: 0 },
      school.moderator,
    );
    await drain();
    const cls = (await contingent.listClasses())[0];
    const roster = await contingent.listStudents(cls.id);
    const fio = [['Абалкин', 'Юрий'], ['Егоров', 'Пётр'], ['Ёлкина', 'Анна']];
    for (let i = 0; i < roster.length; i += 1) {
      await contingent.updateStudent(roster[i].id, { lastName: fio[i][0], firstName: fio[i][1], sex: i < 2 ? 'm' : 'f' }, school.moderator);
    }
    await drain();

    const subject = await subjects.create({ name: 'Математика', classId: cls.id });
    const token = await subjects.createBindToken(subject.id);
    await subjects.scan(token.token, { userId: teacher.userId, workspaceId: school.workspaceId, roles: ['teacher'], name: 'педагог' });
    await subjects.bindTeacher(subject.id, { token: token.token, scope: 'class' }, school.moderator);
    await drain();

    // Четверти считаются ОТ сегодняшнего дня: сценарии проверяют и прошедшие
    // уроки (отметка принимается), и будущие (гейт `LESSON_NOT_HELD`), а значит
    // сегодня обязано попадать внутрь первой четверти.
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
    // Восемь часов на пятидневке при четырёх уроках в день дают дни с ДВУМЯ
    // уроками одного предмета — это и есть «две колонки под одним числом» (AR-74).
    await schedule.setLoad({ entries: load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerWeek: 8 })), version: load.version }, school.moderator);
    await schedule.setPriorities({ subjectIds: [], explicitNone: true });
    const reg = await state.register();
    await schedule.setDayParams(
      { slotsPerDay: 4, lessonMin: 45, breakMin: 10, days: 5, bigBreakAfter: 2, bigBreakMin: 30, version: reg.scheduleVersion },
      school.moderator,
    );
    const preview = await schedule.generate(school.moderator);
    const reg2 = await state.register();
    await schedule.confirm({ templateId: preview.templateId, version: reg2.scheduleVersion }, school.moderator);
    await drain();

    const students = await contingent.listStudents(cls.id);
    return {
      ...school,
      classId: cls.id,
      subjectId: subject.id,
      teacher,
      studentIds: students.map((s) => s.id),
      templateId: preview.templateId,
    };
  });
}

/**
 * Стенд не умеет ждать. Материализация смотрит ВПЕРЁД (горизонт три недели,
 * AR-73), поэтому у только что подтверждённой школы прошедших уроков нет вовсе —
 * а если прогон пришёлся на выходной, их нет и сегодня. Сценарии про отметки без
 * прошедшего урока доказывали бы половину инварианта, поэтому здесь ход времени
 * имитируется явно: самый ранний урок и его колонка в журнале переносятся на
 * вчерашний день.
 *
 * Это приём СТЕНДА, а не поведение продукта: прод даты уроков не двигает никогда.
 */
export async function ensurePastLesson(b: Bench, workspaceId: string): Promise<void> {
  await TenantContext.runAsSystem(async () => {
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const past = await b.prisma.schoolLesson.count({ where: { workspaceId, date: { lte: today } } });
    if (past > 0) return;
    const first = await b.prisma.schoolLesson.findFirst({ where: { workspaceId }, orderBy: { date: 'asc' } });
    if (!first) return;
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    await b.prisma.schoolLesson.update({ where: { id: first.id }, data: { date: yesterday } });
    await b.prisma.journalColumn.updateMany({ where: { lessonId: first.id }, data: { date: yesterday } });
  });
}
