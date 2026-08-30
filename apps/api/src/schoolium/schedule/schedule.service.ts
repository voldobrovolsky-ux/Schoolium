import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DAY_MINUTES_CAP,
  DAY_SLOTS_CAP,
  schoolDayCap,
  type ConfirmScheduleDto,
  type DayParamsDto,
  type SchedulePreviewDto,
  type SetLoadDto,
  type SetPrioritiesDto,
  type TemplateSlotDto,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent, type DomainEvent } from '../../common/events/domain-event';
import { EventBus } from '../../common/events/event-bus';
import {
  SCHOOL_EVENTS,
  STALE_ON_EVENTS,
  type LessonDetachedV1,
  type LessonMaterializedV1,
  type TemplateConfirmedV1,
} from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';
import { schoolToday } from '../calendar/school-day';
import { SchoolStateService, uncoveredGroups } from '../school-state.service';
import { ContingentContractService } from '../contingent/contingent.service';
import { SubjectsContractService } from '../subjects/subjects.service';
import { CalendarContractService } from '../calendar/calendar.service';
import { JournalContractService } from '../journal/journal.service';
import {
  HORIZON_WEEKS,
  arithmeticRefusal,
  dayLength,
  dayLengthBreakdown,
  generate,
  plannedLessons,
  type GenInput,
  type GenPair,
  type GenSlot,
} from './generator';
import type { SchoolActor } from '../actor';

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const parseDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
/** Ключ урока против шаблона: день недели, слот, класс, группа, предмет. */
const lessonKey = (dow: number, slotNo: number, classId: string, groupNo: number, subjectId: string): string =>
  `${dow}:${slotNo}:${classId}:${groupNo}:${subjectId}`;

/**
 * Расписание: нагрузка, приоритеты, параметры дня, генерация, подтверждение и
 * жизненный цикл сетки (AR-73, AR-84, AR-85, AR-101, AR-103, AR-107).
 *
 * Сетка — ПРЕДЛОЖЕНИЕ до нажатия «Подтвердить» (AR-18, красная линия 1):
 * автоприменение по таймеру или «раз всё зелёное» запрещено.
 */
@Injectable()
export class ScheduleService implements OnModuleInit {
  private readonly log = new Logger('Schedule');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly bus: EventBus,
    private readonly state: SchoolStateService,
    private readonly contingent: ContingentContractService,
    private readonly subjects: SubjectsContractService,
    private readonly calendar: CalendarContractService,
    private readonly journal: JournalContractService,
  ) {}

  /**
   * Таксономия правок (AR-85) выражена ПОДПИСКАМИ, а не догадкой исполнителя:
   * восемь событий делают сетку устаревшей, события контингента — нет. Поэтому
   * приём ученика в середине четверти не поднимает плашку «расписание устарело»
   * и не подталкивает модератора к регенерации ради одной строки контингента.
   */
  onModuleInit(): void {
    for (const type of STALE_ON_EVENTS) {
      this.bus.subscribe(type, 'schedule', (e) => this.markStale(e));
    }
  }

  /**
   * Правка СОБСТВЕННЫХ данных расписания — нагрузка, приоритеты, параметры дня —
   * тоже роняет сетку в `stale` (AR-85), но событием не сопровождается: у этих
   * мутаций в `70-screens.md` §11 события нет, потому что издавать его некому и
   * незачем — писатель и подписчик тут один модуль. Метка ставится прямо.
   */
  private async staleSelf(): Promise<void> {
    const r = await this.prisma.scheduleTemplate.updateMany({
      where: { status: { in: ['confirmed', 'draft'] } },
      data: { status: 'stale' },
    });
    if (r.count) this.log.log('сетка → stale по правке нагрузки/приоритетов/параметров дня');
  }

  private async markStale(e: DomainEvent): Promise<void> {
    await TenantContext.runAsSystem(async () => {
      const r = await this.prisma.scheduleTemplate.updateMany({
        // Устаревают только сетки, собранные ДО события: плашка говорит «данные
        // изменились после генерации», а событие доезжает через outbox с лагом —
        // сетка, собранная позже него, эти данные уже видела и устареть от них
        // не может (АР-85).
        where: {
          workspaceId: e.workspaceId,
          status: { in: ['confirmed', 'draft'] },
          generatedAt: { lt: new Date(e.occurredAt) },
        },
        data: { status: 'stale' },
      });
      if (r.count) this.log.log(`сетка → stale по ${e.type}`);
    });
  }

  // ─────────────── экран 2: нагрузка (§11 строка 18) ───────────────

  /** Список пар «педагог × предмет × класс/группа» с текущими часами. */
  async load() {
    const [subjects, classes, users] = await Promise.all([
      this.subjects.subjectsWithBindings(),
      this.contingent.classes(),
      TenantContext.runAsSystem(() => this.prisma.user.findMany({ select: { id: true, displayName: true } })),
    ]);
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    const entries = subjects.flatMap((s) =>
      s.bindings.map((b) => ({
        bindingId: b.id,
        teacherId: b.teacherId,
        teacherName: names.get(b.teacherId) ?? '—',
        subjectId: s.id,
        subjectName: s.name,
        classId: s.classId,
        classLabel: classes.find((c) => c.id === s.classId)?.label ?? '—',
        scope: b.scope,
        groupNos: b.groupNos,
        hoursPerWeek: b.hoursPerWeek,
      })),
    );
    const reg = await this.state.register();
    return { entries, version: reg.scheduleVersion };
  }

  /**
   * Отказы экрана 2 вычисляются арифметикой СРАЗУ при вводе, до генерации
   * (стенд P5). Все четыре — `LOAD_EXCEEDS_SANPIN`, `LOAD_EXCEEDS_GRID`,
   * `GROUP_HOURS_UNEQUAL`, `TEACHER_OVERBOOKED` — считаются на том же наборе
   * правил, что и в генераторе: одна арифметика, две точки применения.
   */
  async setLoad(dto: SetLoadDto, actor: SchoolActor) {
    await this.state.checkVersion('schedule', dto.version);
    const ws = TenantContext.require();
    for (const e of dto.entries) {
      await this.prisma.teacherBinding.updateMany({
        where: { id: e.bindingId },
        data: { hoursPerWeek: Math.max(0, e.hoursPerWeek) },
      });
    }
    const input = await this.buildInput(0);
    const refusal = arithmeticRefusal(input);
    // Экрану 2 принадлежат четыре отказа из девяти. Отказы экрана 4
    // (`DAY_EXCEEDS_SANPIN`, `DAY_TOO_LONG`) и отказы генерации
    // (`SUBJECT_UNCOVERED`, `GROUPS_UNASSIGNED`) сюда не относятся — у каждого
    // свой экран и своя кнопка возврата.
    const notHere = ['DAY_EXCEEDS_SANPIN', 'DAY_TOO_LONG', 'SUBJECT_UNCOVERED', 'GROUPS_UNASSIGNED'];
    // «Слоты недели» = дни × уроков в день, а «уроков в день» собирается ЭКРАНОМ 4
    // (AR-103) — то есть ПОСЛЕ этого экрана в порядке мастера. Пока параметры дня
    // не заданы, второго множителя не существует, и два отказа из четырёх
    // посчитать нечем: они проверяются на экране 4 и перед перебором. Считать их
    // здесь при `slotsPerDay = 0` означало бы отказать любой ненулевой нагрузке.
    const reg = await this.state.register();
    if (!reg.dayParamsSet) notHere.push('LOAD_EXCEEDS_GRID', 'TEACHER_OVERBOOKED');
    if (refusal && !notHere.includes(refusal.code)) {
      throw new SchoolError(refusal.code, refusal.details);
    }
    await this.prisma.$transaction((tx) => this.state.bump(tx, 'schedule', { id: actor.userId, name: actor.name }, ws));
    await this.staleSelf();
    return { ok: true };
  }

  // ─────────────── экран 3: приоритеты (§11 строка 19) ───────────────

  /** Список может быть пустым только через ЯВНЫЙ отказ «⌀ Без приоритетов» (AR-77). */
  async setPriorities(dto: SetPrioritiesDto) {
    // Пустое поле выбором не считается (AR-77): пустой список приоритетов
    // принимается только вместе с явным нажатием «⌀ Без приоритетов».
    if (!dto.subjectIds.length && !dto.explicitNone) {
      throw new BadRequestException('Отметьте приоритетные предметы или нажмите «Без приоритетов»');
    }
    await this.prisma.schoolSubject.updateMany({ data: { priority: false } });
    if (dto.subjectIds.length) {
      await this.prisma.schoolSubject.updateMany({ where: { id: { in: dto.subjectIds } }, data: { priority: true } });
    }
    const ws = TenantContext.require();
    await this.prisma.schoolState.upsert({
      where: { workspaceId: ws },
      update: { prioritiesSet: true },
      create: { workspaceId: ws, prioritiesSet: true },
    });
    await this.staleSelf();
    return { ok: true };
  }

  // ─────────────── экран 4: параметры дня (§11 строка 20) ───────────────

  /**
   * «Уроков в день» — не украшение экрана, а ВТОРОЙ МНОЖИТЕЛЬ «слотов недели»
   * (AR-103): без него не считаются ни `LOAD_EXCEEDS_GRID`, ни
   * `TEACHER_OVERBOOKED`. Четыре временных параметра потребляются строкой
   * `S-41.calc.dayLength` — мёртвого ввода на экране нет.
   */
  async setDayParams(dto: DayParamsDto, actor: SchoolActor) {
    await this.state.checkVersion('schedule', dto.version);
    const ws = TenantContext.require();
    const classes = await this.contingent.classes();
    // AR-114: число — верхняя граница школьного дня; отказ только когда оно выше
    // потолка самой старшей параллели. День каждого класса генератор ограничит
    // потолком его собственной параллели.
    const cap = schoolDayCap(classes.map((c) => c.parallel));
    if (classes.length > 0 && dto.slotsPerDay > cap) {
      const senior = classes.reduce((a, c) => (DAY_SLOTS_CAP[c.parallel] > DAY_SLOTS_CAP[a.parallel] ? c : a), classes[0]);
      throw new SchoolError('DAY_EXCEEDS_SANPIN', { classLabel: senior.label, slotsPerDay: dto.slotsPerDay, cap });
    }
    const minutes = dayLength(dto);
    if (minutes > DAY_MINUTES_CAP) {
      throw new SchoolError('DAY_TOO_LONG', { minutes, cap: DAY_MINUTES_CAP, breakdown: dayLengthBreakdown(dto) });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolState.upsert({
        where: { workspaceId: ws },
        update: { ...pickParams(dto), dayParamsSet: true },
        create: { workspaceId: ws, ...pickParams(dto), dayParamsSet: true },
      });
      await this.state.bump(tx, 'schedule', { id: actor.userId, name: actor.name }, ws);
    });
    await this.staleSelf();
    return { ok: true, dayLengthMinutes: minutes, cap: DAY_MINUTES_CAP };
  }

  // ─────────────── генерация (§11 строки 21, 34) ───────────────

  private async buildInput(seed: number): Promise<GenInput> {
    const [classes, subjects, unassigned, reg] = await Promise.all([
      this.contingent.classes(),
      this.subjects.subjectsWithBindings(),
      this.contingent.classesWithUnassignedGroups(),
      this.state.register(),
    ]);
    const users = await TenantContext.runAsSystem(() =>
      this.prisma.user.findMany({ select: { id: true, displayName: true } }),
    );
    const names = new Map(users.map((u) => [u.id, u.displayName]));

    const pairs: GenPair[] = subjects.flatMap((s) =>
      s.bindings.map((b) => ({
        subjectId: s.id,
        subjectName: s.name,
        classId: s.classId,
        teacherId: b.teacherId,
        teacherName: names.get(b.teacherId) ?? '—',
        scope: b.scope as 'class' | 'group',
        groupNos: b.groupNos,
        hours: b.hoursPerWeek,
        priority: s.priority,
      })),
    );
    const uncovered = subjects
      .map((s) => {
        const cls = classes.find((c) => c.id === s.classId);
        return {
          subjectId: s.id,
          subjectName: s.name,
          classId: s.classId,
          groups: uncoveredGroups(s.id, cls?.groupCount ?? 0, s.bindings).filter((g) => g > 0),
        };
      })
      .filter((u) => {
        const cls = classes.find((c) => c.id === u.classId);
        return uncoveredGroups(u.subjectId, cls?.groupCount ?? 0, subjects.find((s) => s.id === u.subjectId)!.bindings).length > 0;
      });

    return {
      classes,
      pairs,
      params: {
        days: reg.days,
        slotsPerDay: reg.slotsPerDay,
        lessonMin: reg.lessonMin,
        breakMin: reg.breakMin,
        bigBreakAfter: reg.bigBreakAfter,
        bigBreakMin: reg.bigBreakMin,
        dayStartMin: reg.dayStartMin,
      },
      seed,
      classesWithUnassignedGroups: unassigned,
      uncovered,
    };
  }

  /**
   * `S-42`. Результат — ПРЕДЛОЖЕНИЕ: шаблон создаётся в статусе `draft`, уроки не
   * материализуются. Зерно берётся из `GEN_SEED`, если он задан (AR-97): жалоба
   * «сетка странная» воспроизводится точно.
   */
  async generate(actor: SchoolActor) {
    const ws = TenantContext.require();
    // года без данных календаря не бывает молча (AR-100): отказ ДО перебора
    const terms = await this.calendar.terms();
    for (const t of terms) this.calendar.assertYear(t.dateFrom.getUTCFullYear());
    if (!terms.length) this.calendar.assertYear(schoolToday().getUTCFullYear());

    const envSeed = Number(process.env.GEN_SEED);
    const seed = Number.isFinite(envSeed) && envSeed > 0 ? envSeed : Math.floor(Date.now() % 2_000_000_000);
    const input = await this.buildInput(seed);
    const res = generate(input);
    if (!res.ok) {
      this.log.warn(`генерация отклонена: ${res.code} (зерно ${seed}, попыток ${res.attempts}, ${res.durationMs} мс)`);
      throw new SchoolError(res.code, res.details);
    }
    this.log.log(`сетка собрана: зерно ${seed}, попыток ${res.attempts}, ${res.durationMs} мс`);

    await this.prisma.scheduleTemplate.deleteMany({ where: { status: 'draft' } });
    const tpl = await this.prisma.scheduleTemplate.create({
      data: {
        workspaceId: ws,
        status: 'draft',
        seed,
        days: input.params.days,
        slotsPerDay: input.params.slotsPerDay,
        lessonMin: input.params.lessonMin,
        breakMin: input.params.breakMin,
        bigBreakAfter: input.params.bigBreakAfter,
        bigBreakMin: input.params.bigBreakMin,
        dayStartMin: input.params.dayStartMin ?? 540,
        attempts: res.attempts,
        durationMs: res.durationMs,
      },
    });
    await this.prisma.templateSlot.createMany({
      data: res.slots.map((s) => ({
        workspaceId: ws,
        templateId: tpl.id,
        dayNo: s.dayNo,
        slotNo: s.slotNo,
        classId: s.classId,
        groupNo: s.groupNo,
        subjectId: s.subjectId,
        teacherId: s.teacherId,
      })),
    });
    return this.preview(tpl.id);
  }

  /** `S-42.btn.cancelGen`: шаблон не создаётся, школа остаётся в `day_params_set`. */
  async cancelGeneration() {
    await this.prisma.scheduleTemplate.deleteMany({ where: { status: 'draft' } });
    return { ok: true };
  }

  async preview(templateId?: string): Promise<SchedulePreviewDto> {
    const tpl = templateId
      ? await this.prisma.scheduleTemplate.findUnique({ where: { id: templateId }, include: { slots: true } })
      : await this.prisma.scheduleTemplate.findFirst({ orderBy: { generatedAt: 'desc' }, include: { slots: true } });
    if (!tpl) throw new NotFoundException('шаблон не найден');

    const [classes, subjects, users, reg] = await Promise.all([
      this.contingent.classes(),
      this.subjects.subjectsWithBindings(),
      TenantContext.runAsSystem(() => this.prisma.user.findMany({ select: { id: true, displayName: true } })),
      this.state.register(),
    ]);
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    const slots: TemplateSlotDto[] = tpl.slots.map((s) => ({
      dayNo: s.dayNo,
      slotNo: s.slotNo,
      classId: s.classId,
      classLabel: classes.find((c) => c.id === s.classId)?.label ?? '—',
      groupNo: s.groupNo === 0 ? null : s.groupNo,
      subjectId: s.subjectId,
      subjectName: subjects.find((x) => x.id === s.subjectId)?.name ?? '—',
      teacherId: s.teacherId,
      teacherName: names.get(s.teacherId) ?? '—',
    }));

    // `S-42.warn.detach`: сколько уроков С ОТМЕТКАМИ не найдут себя в новом
    // шаблоне. Кнопка подтверждения от этого не меняет текста — отметки не
    // удаляются ни при каком выборе (AR-85).
    const willDetach = (await this.detachCandidates(tpl.slots)).length;
    const half = Math.ceil(tpl.slotsPerDay / 2);
    const priorityWarnings = [
      ...new Set(
        tpl.slots
          .filter((s) => subjects.find((x) => x.id === s.subjectId)?.priority && s.slotNo > half)
          .map((s) => {
            const subj = subjects.find((x) => x.id === s.subjectId)?.name ?? '—';
            const cls = classes.find((c) => c.id === s.classId)?.label ?? '—';
            return `${subj} в ${cls} классе не попал в первую половину дня`;
          }),
      ),
    ];
    return {
      templateId: tpl.id,
      seed: tpl.seed,
      status: tpl.status as 'draft' | 'confirmed' | 'stale',
      grid: {
        dayStartMin: tpl.dayStartMin,
        lessonMin: tpl.lessonMin,
        breakMin: tpl.breakMin,
        bigBreakAfter: tpl.bigBreakAfter,
        bigBreakMin: tpl.bigBreakMin,
      },
      slots,
      priorityWarnings,
      willDetach,
      version: reg.scheduleVersion,
    };
  }

  private async detachCandidates(slots: { dayNo: number; slotNo: number; classId: string; groupNo: number; subjectId: string }[]) {
    const next = new Set(slots.map((s) => lessonKey(s.dayNo, s.slotNo, s.classId, s.groupNo, s.subjectId)));
    const lessons = await this.prisma.schoolLesson.findMany({ where: { detachedAt: null } });
    const orphan = lessons.filter((l) => {
      const dow = (l.date.getUTCDay() + 6) % 7;
      return !next.has(lessonKey(dow, l.slotNo, l.classId, l.groupNo, l.subjectId));
    });
    const withMarks = await this.journal.lessonsWithMarks(orphan.map((l) => l.id));
    return orphan.filter((l) => withMarks.has(l.id));
  }

  // ─────────────── подтверждение и материализация (§11 строка 22) ───────────────

  /**
   * `S-42.btn.confirm` — единственный путь к материализации (AR-18).
   *
   * Судьба ранее материализованного урока (правило `detach-marked`, стенд P8):
   *   есть в новом шаблоне  → остаётся как есть, отметки на месте;
   *   нет, отметок нет      → исчезает вместе со старым шаблоном, молча;
   *   нет, отметки есть     → ОТВЯЗЫВАЕТСЯ (`detachedAt` + `schedule.lesson.detached.v1`),
   *                           остаётся колонкой журнала с пометкой «вне расписания».
   * Отметка не удаляется пересборкой расписания никогда (красная линия 10).
   */
  async confirm(dto: ConfirmScheduleDto, actor: SchoolActor) {
    await this.state.checkVersion('schedule', dto.version);
    const ws = TenantContext.require();
    const tpl = await this.prisma.scheduleTemplate.findUnique({ where: { id: dto.templateId }, include: { slots: true } });
    if (!tpl) throw new NotFoundException('шаблон не найден');

    const next = new Set(tpl.slots.map((s) => lessonKey(s.dayNo, s.slotNo, s.classId, s.groupNo, s.subjectId)));
    const existing = await this.prisma.schoolLesson.findMany({ where: { detachedAt: null } });
    const orphan = existing.filter((l) => {
      const dow = (l.date.getUTCDay() + 6) % 7;
      return !next.has(lessonKey(dow, l.slotNo, l.classId, l.groupNo, l.subjectId));
    });
    const withMarks = await this.journal.lessonsWithMarks(orphan.map((l) => l.id));

    await this.prisma.$transaction(async (tx) => {
      for (const l of orphan) {
        if (withMarks.has(l.id)) {
          await tx.schoolLesson.update({ where: { id: l.id }, data: { detachedAt: new Date() } });
          await this.outbox.enqueue(
            tx,
            newEvent<LessonDetachedV1>({
              type: SCHOOL_EVENTS.lessonDetached,
              workspaceId: ws,
              actor: actor.userId,
              payload: { lessonId: l.id, date: isoDay(l.date), classId: l.classId, reason: 'regenerated' },
            }),
          );
        } else {
          await tx.schoolLesson.delete({ where: { id: l.id } });
        }
      }
      await tx.scheduleTemplate.updateMany({ where: { status: { in: ['confirmed', 'stale'] } }, data: { status: 'stale' } });
      await tx.scheduleTemplate.update({ where: { id: tpl.id }, data: { status: 'confirmed', confirmedAt: new Date() } });
      await this.outbox.enqueue(
        tx,
        newEvent<TemplateConfirmedV1>({
          type: SCHOOL_EVENTS.templateConfirmed,
          workspaceId: ws,
          actor: actor.userId,
          payload: { templateId: tpl.id, seed: tpl.seed, weekSlots: tpl.slots.length },
        }),
      );
      await this.state.bump(tx, 'schedule', { id: actor.userId, name: actor.name }, ws);
    });

    // старые шаблоны, кроме подтверждённого, больше не нужны
    await this.prisma.scheduleTemplate.deleteMany({ where: { status: 'stale', id: { not: tpl.id } } });
    const created = await this.materialize(actor.userId);
    return { ok: true, detached: orphan.filter((l) => withMarks.has(l.id)).length, materialized: created };
  }

  /**
   * Идемпотентная материализация (AR-101). Повторный прогон на тех же данных не
   * создаёт ни одной записи — именно поэтому триггеров три и они не конфликтуют:
   * подтверждение сетки, ночной крон и открытие журнала с коротким горизонтом.
   */
  async materialize(actorId = 'system'): Promise<number> {
    const ws = TenantContext.require();
    const tpl = await this.prisma.scheduleTemplate.findFirst({ where: { status: 'confirmed' }, include: { slots: true } });
    if (!tpl) return 0;
    const terms = await this.calendar.terms();
    if (!terms.length) return 0;
    for (const t of terms) this.calendar.assertYear(t.dateFrom.getUTCFullYear());

    const from = schoolToday();
    const start = from < terms[0].dateFrom ? terms[0].dateFrom : from;
    const planned = plannedLessons({
      slots: tpl.slots.map<GenSlot>((s) => ({
        dayNo: s.dayNo, slotNo: s.slotNo, classId: s.classId, groupNo: s.groupNo, subjectId: s.subjectId, teacherId: s.teacherId,
      })),
      from: start,
      weeks: HORIZON_WEEKS,
      isSchoolDay: (d) => this.calendar.isSchoolDay(d),
      inTerm: (d) => terms.some((t) => d >= t.dateFrom && d <= t.dateTo),
    });

    let created = 0;
    for (const p of planned) {
      const key = {
        workspaceId_date_slotNo_classId_groupNo: {
          workspaceId: ws,
          date: parseDay(p.date),
          slotNo: p.slot.slotNo,
          classId: p.slot.classId,
          groupNo: p.slot.groupNo,
        },
      };
      const exists = await this.prisma.schoolLesson.findUnique({ where: key });
      if (exists) continue; // ключ идемпотентности: дата + слот + класс + группа
      await this.prisma.$transaction(async (tx) => {
        const lesson = await tx.schoolLesson.create({
          data: {
            workspaceId: ws,
            date: parseDay(p.date),
            slotNo: p.slot.slotNo,
            classId: p.slot.classId,
            groupNo: p.slot.groupNo,
            subjectId: p.slot.subjectId,
            teacherId: p.slot.teacherId,
            templateId: tpl.id,
          },
        });
        await this.outbox.enqueue(
          tx,
          newEvent<LessonMaterializedV1>({
            type: SCHOOL_EVENTS.lessonMaterialized,
            workspaceId: ws,
            actor: actorId,
            payload: {
              lessonId: lesson.id,
              date: p.date,
              slotNo: p.slot.slotNo,
              classId: p.slot.classId,
              groupNo: p.slot.groupNo === 0 ? null : p.slot.groupNo,
              subjectId: p.slot.subjectId,
              teacherId: p.slot.teacherId,
            },
          }),
        );
      });
      created += 1;
    }
    if (created) this.log.log(`материализовано уроков: ${created}`);
    return created;
  }

  /** Триггер «ночной крон»: двигает горизонт вперёд по всем школам базы. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightlyMaterialize(): Promise<void> {
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.scheduleTemplate.findMany({ where: { status: 'confirmed' }, select: { workspaceId: true } }),
    );
    for (const r of rows) {
      await TenantContext.run({ tenantId: r.workspaceId, system: false }, () => this.materialize('cron'));
    }
  }

  /** Вид `S-40`: сетка недели и статус (в том числе плашка «устарело»). */
  async week(): Promise<SchedulePreviewDto | null> {
    const tpl = await this.prisma.scheduleTemplate.findFirst({ orderBy: { generatedAt: 'desc' } });
    if (!tpl) return null;
    return this.preview(tpl.id);
  }
}

const pickParams = (d: DayParamsDto) => ({
  days: d.days,
  slotsPerDay: d.slotsPerDay,
  lessonMin: d.lessonMin,
  breakMin: d.breakMin,
  bigBreakAfter: d.bigBreakAfter,
  bigBreakMin: d.bigBreakMin,
  dayStartMin: d.dayStartMin ?? 540,
});
