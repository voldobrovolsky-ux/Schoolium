import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  type ClassLunchEntryDto,
  type ConfirmScheduleDto,
  type DayParamsDto,
  type DaySkeletonDto,
  type GridKind,
  type SchedulePreviewDto,
  type SetClassLunchDto,
  type SetSkeletonDto,
  type SetTeacherPreferenceDto,
  type SkeletonKind,
  type SkeletonPositionDto,
  type SetLoadDto,
  type SetPrioritiesDto,
  type SwapSlotsDto,
  type TeacherPreferenceDto,
  type TemplateSlotDto,
  weeklyOfYear,
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
  type PreferenceSetV1,
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
  generate,
  plannedLessons,
  type GenInput,
  type GenPair,
  type GenSlot,
} from './generator';
import type { SchoolActor } from '../actor';
import { actorHas } from './substitution.service';

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const parseDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
/** Ключ урока против шаблона: день недели, слот, класс, группа, предмет. */
const lessonKey = (dow: number, slotNo: number, classId: string, groupNo: number, subjectId: string): string =>
  `${dow}:${slotNo}:${classId}:${groupNo}:${subjectId}`;

/**
 * Расписание: нагрузка, приоритеты, параметры дня, скелет, обед по классам,
 * предпочтения педагогов, генерация, подтверждение и жизненный цикл сетки
 * (AR-73, AR-84, AR-85, AR-101, AR-103, AR-107, AR-199, AR-200, AR-206).
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
        hoursPerYear: b.hoursPerYear,
      })),
    );
    const reg = await this.state.register();
    return { entries, version: reg.scheduleVersion };
  }

  /**
   * Отказы экрана 2 вычисляются арифметикой СРАЗУ при вводе, до генерации
   * (стенд P5). Все три — `LOAD_EXCEEDS_GRID`, `GROUP_HOURS_UNEQUAL`,
   * `TEACHER_OVERBOOKED` — считаются на том же наборе правил, что и в
   * генераторе: одна арифметика, две точки применения. Потолка недельной
   * нагрузки класса нет: `LOAD_EXCEEDS_SANPIN` выведен из употребления (AR-199).
   */
  async setLoad(dto: SetLoadDto, actor: SchoolActor) {
    await this.state.checkVersion('schedule', dto.version);
    const ws = TenantContext.require();
    for (const e of dto.entries) {
      // Ввод — ГОДОВАЯ норма (AR-180); недельные часы генератора — производная
      // одной точки конверсии, а не второй ввод.
      const year = Math.max(0, e.hoursPerYear);
      await this.prisma.teacherBinding.updateMany({
        where: { id: e.bindingId },
        data: { hoursPerYear: year, hoursPerWeek: weeklyOfYear(year) },
      });
    }
    const input = await this.buildInput(0);
    const refusal = arithmeticRefusal(input);
    // Экрану 2 принадлежат три отказа из семи. Отказы генерации
    // (`SUBJECT_UNCOVERED`, `GROUPS_UNASSIGNED`) и рабочих дней педагога
    // (`TEACHER_DAYS_SHORT` — «при генерации», §S-41.2, AR-206) сюда не
    // относятся — у каждого свой экран и своя кнопка возврата; завуч рабочими
    // днями педагога не распоряжается.
    const notHere = ['SUBJECT_UNCOVERED', 'GROUPS_UNASSIGNED', 'TEACHER_DAYS_SHORT'];
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
    // AR-199 (школа полного дня): длину дня и число уроков задаёт школа —
    // `DAY_EXCEEDS_SANPIN` и `DAY_TOO_LONG` выведены из употребления и не
    // бросаются ни со скелетом, ни без. Длина дня считается для справки
    // `S-41.calc.dayLength` («Учебный день: N минут»).
    const minutes = dayLength(dto);
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolState.upsert({
        where: { workspaceId: ws },
        update: { ...pickParams(dto), dayParamsSet: true },
        create: { workspaceId: ws, ...pickParams(dto), dayParamsSet: true },
      });
      await this.state.bump(tx, 'schedule', { id: actor.userId, name: actor.name }, ws);
    });
    await this.staleSelf();
    return { ok: true, dayLengthMinutes: minutes };
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

    // Скелет дня (AR-171, фаза III): урочные позиции по дням — вход укладки.
    // Пустой скелет = null: прежняя укладка арифметикой параметров дня.
    const skel = await this.skeleton();
    const skeleton = skel.positions.length
      ? {
          gridKind: skel.gridKind,
          days: [...new Set(skel.positions.map((p) => p.dayNo))].map((dayNo) => ({
            dayNo,
            lessons: skel.positions
              .filter((p) => p.dayNo === dayNo && p.kind === 'lesson')
              .sort((a, b) => a.posNo - b.posNo)
              .map((p) => ({ lessonNo: p.lessonNo ?? 0, pairNo: p.pairNo ?? null })),
          })),
        }
      : null;

    // Обед по классам (AR-200): позиция обеда = `lunchAfterLessonNo + 1`; класс
    // без своего обеда в карту не попадает — обедает в позиции `meal` школы.
    const classLunch: Record<string, number> = {};
    for (const e of skel.classLunch) {
      if (e.lunchAfterLessonNo !== null) classLunch[e.classId] = e.lunchAfterLessonNo + 1;
    }

    // Рабочие дни педагогов (AR-206): пустой список = любой день — в карту не идёт.
    // Генератору нужны дни, а не заметки, поэтому читается хранилище напрямую.
    const teacherDays: Record<string, number[]> = {};
    for (const p of await this.preferenceRows()) {
      if (p.workDays.length) teacherDays[p.teacherId] = p.workDays;
    }

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
      skeleton,
      classLunch,
      teacherDays,
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

  /**
   * `S-43` (AR-175, УТЦ v1.4 фаза IV): перестановка двух слотов ОДНОГО класса
   * в ЧЕРНОВИКЕ местами; пустая сторона легальна — это перенос урока в окно.
   * Материализует по-прежнему только `confirm` (AR-18). Жёсткое ограничение
   * генератора «педагог не в двух местах разом» держится и здесь: занятость в
   * целевом слоте другим классом — именованный `SWAP_CONFLICT` с фамилией.
   */
  async swapSlots(dto: SwapSlotsDto, actor: SchoolActor) {
    await this.state.checkVersion('schedule', dto.version);
    const ws = TenantContext.require();
    const tpl = await this.prisma.scheduleTemplate.findUnique({ where: { id: dto.templateId }, include: { slots: true } });
    if (!tpl || tpl.status !== 'draft') throw new NotFoundException('черновик не найден');

    const at = (p: { dayNo: number; slotNo: number }) =>
      tpl.slots.filter((s) => s.classId === dto.classId && s.dayNo === p.dayNo && s.slotNo === p.slotNo);
    const aSlots = at(dto.a);
    const bSlots = at(dto.b);
    if (!aSlots.length && !bSlots.length) throw new NotFoundException('в обоих слотах пусто — переставлять нечего');

    const busyElsewhere = (teacherId: string, dayNo: number, slotNo: number) =>
      tpl.slots.some((s) => s.classId !== dto.classId && s.teacherId === teacherId && s.dayNo === dayNo && s.slotNo === slotNo);
    const conflicted =
      aSlots.find((s) => busyElsewhere(s.teacherId, dto.b.dayNo, dto.b.slotNo)) ??
      bSlots.find((s) => busyElsewhere(s.teacherId, dto.a.dayNo, dto.a.slotNo));
    if (conflicted) {
      const u = await TenantContext.runAsSystem(() =>
        this.prisma.user.findUnique({ where: { id: conflicted.teacherId }, select: { displayName: true } }),
      );
      throw new SchoolError('SWAP_CONFLICT', { teacher: u?.displayName ?? '—' });
    }

    await this.prisma.$transaction(async (tx) => {
      // Уникальность слота `[templateId, dayNo, slotNo, classId, groupNo]` не
      // даёт поменять две стороны в лоб: сторона A уезжает в невозможный
      // промежуточный номер, затем B встаёт на место A, затем A — на место B.
      await tx.templateSlot.updateMany({
        where: { id: { in: aSlots.map((s) => s.id) } },
        data: { slotNo: -1 },
      });
      await tx.templateSlot.updateMany({
        where: { id: { in: bSlots.map((s) => s.id) } },
        data: { dayNo: dto.a.dayNo, slotNo: dto.a.slotNo },
      });
      await tx.templateSlot.updateMany({
        where: { id: { in: aSlots.map((s) => s.id) } },
        data: { dayNo: dto.b.dayNo, slotNo: dto.b.slotNo },
      });
      // Версия агрегата (AR-109); черновик не материализован — stale нет.
      await this.state.bump(tx, 'schedule', { id: actor.userId, name: actor.name }, ws);
    });
    return this.preview(tpl.id);
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
    const skel = await this.skeleton();
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
      skeleton: skel.positions.length ? skel.positions : null,
      gridKind: skel.gridKind,
      // AR-200: `S-40` вставляет строку «Обед» после урока N в дне класса
      classLunch: skel.classLunch,
      slots,
      priorityWarnings,
      willDetach,
      version: reg.scheduleVersion,
    };
  }

  // ─────────────── скелет дня (AR-171, УТЦ v1.4 фаза I) ───────────────

  /** `GET /v1/schedule/skeleton` — скелет школы; пустой список = фолбэк на grid. */
  async skeleton(): Promise<DaySkeletonDto> {
    const ws = TenantContext.require();
    const [rows, reg, classLunch] = await Promise.all([
      this.prisma.skeletonPosition.findMany({ where: { workspaceId: ws }, orderBy: [{ dayNo: 'asc' }, { posNo: 'asc' }] }),
      this.state.register(),
      this.classLunch(),
    ]);
    const st = await this.prisma.schoolState.findUnique({ where: { workspaceId: ws }, select: { gridKind: true } });
    return {
      gridKind: (st?.gridKind as GridKind) ?? 'paired',
      positions: rows.map((r) => ({
        dayNo: r.dayNo,
        posNo: r.posNo,
        kind: r.kind as SkeletonKind,
        title: r.title,
        startMin: r.startMin,
        endMin: r.endMin,
        lessonNo: r.lessonNo,
        pairNo: r.pairNo,
      })),
      classLunch,
      version: reg.scheduleVersion,
    };
  }

  // ─────────────── обед по классам (AR-200, §11 строка 49) ───────────────

  /**
   * Обед каждого класса школы: `null` — как у школы (позиция `meal` скелета).
   * Колонка живёт на классе (`SchoolClass.lunchAfterLessonNo`), но задаётся и
   * читается расписанием: это параметр укладки, а не контингента — контракт
   * контингента её не отдаёт, поэтому чтение здесь прямое и только этой колонки.
   */
  private async classLunch(): Promise<ClassLunchEntryDto[]> {
    const ws = TenantContext.require();
    const rows = await this.prisma.schoolClass.findMany({
      where: { workspaceId: ws },
      select: { id: true, lunchAfterLessonNo: true },
      orderBy: [{ parallel: 'asc' }, { letter: 'asc' }],
    });
    return rows.map((r) => ({ classId: r.id, lunchAfterLessonNo: r.lunchAfterLessonNo }));
  }

  /**
   * Сколько урочных позиций в дне: по скелету — старший `lessonNo` урочной
   * позиции, без скелета — «уроков в день» школы. 0 — день ещё не описан
   * (ни скелета, ни параметров): верхнюю границу обеда судить нечем.
   */
  private async maxLessonPositions(): Promise<number> {
    const ws = TenantContext.require();
    const top = await this.prisma.skeletonPosition.aggregate({
      where: { workspaceId: ws, kind: 'lesson' },
      _max: { lessonNo: true },
    });
    if (top._max.lessonNo) return top._max.lessonNo;
    return (await this.state.register()).slotsPerDay;
  }

  /**
   * `PUT /v1/schedule/lunch` (AR-200): обед после урока N у класса — класс не
   * имеет урока в позиции N+1. Диапазон 1 ≤ N ≤ (позиций − 1) — иначе
   * `SKELETON_INVALID` с причиной словами: «класс 5А: обед после 9-го урока, а
   * уроков в дне 7». Смена обеда меняет укладку — подтверждённая сетка → stale.
   */
  async setLunch(dto: SetClassLunchDto, actor: SchoolActor) {
    await this.state.checkVersion('schedule', dto.version);
    const ws = TenantContext.require();
    if (!Array.isArray(dto?.entries)) throw new BadRequestException('entries — список пар «класс → номер урока перед обедом»');
    const classes = await this.contingent.classes();
    const max = await this.maxLessonPositions();
    for (const e of dto.entries) {
      if (!e || typeof e !== 'object') throw new BadRequestException('запись обеда — объект с classId и lunchAfterLessonNo');
      const cls = classes.find((c) => c.id === e.classId);
      if (!cls) throw new NotFoundException(`класс ${e.classId} не найден`);
      const n = e.lunchAfterLessonNo;
      if (n === null) continue;
      if (!Number.isInteger(n) || n < 1) {
        throw new SchoolError('SKELETON_INVALID', { reason: `класс ${cls.label}: обед после ${n}-го урока — номер урока от 1` });
      }
      // Пока день не описан (ни скелета, ни «уроков в день»), верхней границы
      // нет: поток `S-41.btn.generate` сохраняет обед ДО параметров дня.
      if (max > 0 && n > max - 1) {
        throw new SchoolError('SKELETON_INVALID', { reason: `класс ${cls.label}: обед после ${n}-го урока, а уроков в дне ${max}` });
      }
    }
    await this.prisma.$transaction(async (tx) => {
      for (const e of dto.entries) {
        await tx.schoolClass.updateMany({
          where: { id: e.classId, workspaceId: ws },
          data: { lunchAfterLessonNo: e.lunchAfterLessonNo },
        });
      }
      // Версия агрегата (AR-109): обед — параметр укладки, правится в `M-08`.
      await this.state.bump(tx, 'schedule', { id: actor.userId, name: actor.name }, ws);
    });
    // Позиция обеда меняет, куда лягут уроки класса — сетка устарела (AR-85, AR-200).
    await this.staleSelf();
    return { ok: true, classLunch: await this.classLunch() };
  }

  // ─────────────── предпочтения педагога (AR-206, §11 строка 53) ───────────────

  /** `GET /v1/schedule/preferences/me` — рабочие дни того, кто спрашивает; записи нет = любой день. */
  async myPreference(actor: SchoolActor): Promise<TeacherPreferenceDto> {
    const ws = TenantContext.require();
    const row = await this.prisma.teacherPreference.findUnique({
      where: { workspaceId_teacherId: { workspaceId: ws, teacherId: actor.userId } },
    });
    return { teacherId: actor.userId, workDays: row?.workDays ?? [], note: row?.note ?? null };
  }

  /**
   * `PUT /v1/schedule/preferences/me` — педагог задаёт рабочие дни САМ, без
   * утверждения (AR-206 уточняет AR-135). Версии агрегата нет: запись одна на
   * педагога, правит её только он.
   *
   * Сетку роняет в `stale` и издаёт `schedule.preference.set.v1` ТОЛЬКО смена
   * рабочих дней: на укладку влияют они, а не заметка. Иначе любое открытие и
   * сохранение формы (даже без единой правки) объявляло бы расписание школы
   * устаревшим и останавливало ночную материализацию уроков.
   */
  async setMyPreference(dto: SetTeacherPreferenceDto, actor: SchoolActor): Promise<TeacherPreferenceDto> {
    const ws = TenantContext.require();
    const reg = await this.state.register();
    if (!Array.isArray(dto.workDays) || dto.workDays.some((d) => !Number.isInteger(d) || d < 0 || d > 5)) {
      throw new BadRequestException('Рабочие дни — номера дней недели от ПН (0) до СБ (5)');
    }
    const workDays = [...new Set(dto.workDays)].filter((d) => d < reg.days).sort((a, b) => a - b);
    const note = dto.note?.trim() ? dto.note.trim().slice(0, 500) : null;
    const before = await this.prisma.teacherPreference.findUnique({
      where: { workspaceId_teacherId: { workspaceId: ws, teacherId: actor.userId } },
      select: { workDays: true },
    });
    const daysChanged = JSON.stringify([...(before?.workDays ?? [])].sort((a, b) => a - b)) !== JSON.stringify(workDays);
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherPreference.upsert({
        where: { workspaceId_teacherId: { workspaceId: ws, teacherId: actor.userId } },
        update: { workDays, note },
        create: { workspaceId: ws, teacherId: actor.userId, workDays, note },
      });
      if (daysChanged) {
        await this.outbox.enqueue(
          tx,
          newEvent<PreferenceSetV1>({
            type: SCHOOL_EVENTS.preferenceSet,
            workspaceId: ws,
            actor: actor.userId,
            payload: { teacherId: actor.userId, workDays },
          }),
        );
      }
    });
    if (daysChanged) await this.staleSelf();
    return { teacherId: actor.userId, workDays, note };
  }

  /**
   * `GET /v1/schedule/preferences` — строителю: строка «дни: ПН, ВТ, ЧТ» в
   * `S-41.load.summary`. Рабочие дни видит каждый, кто читает расписание: они
   * объясняют, почему урок стоит именно так. Заметка — свободный текст педагога
   * о себе, и её читают только тот, кто её написал, строитель сетки
   * (`schedule.build`) и надзор (`school.oversee`); коллеге по `schedule.read`
   * возвращается `null`, а не чужое личное сообщение.
   */
  async listPreferences(actor: SchoolActor): Promise<TeacherPreferenceDto[]> {
    const rows = await this.preferenceRows();
    const readsNotes = actorHas(actor, 'schedule.build') || actorHas(actor, 'school.oversee');
    return rows.map((r) => ({
      teacherId: r.teacherId,
      workDays: r.workDays,
      note: readsNotes || r.teacherId === actor.userId ? r.note : null,
    }));
  }

  /** Строки предпочтений школы: общий источник для генератора и для `S-41.load.summary`. */
  private async preferenceRows(): Promise<{ teacherId: string; workDays: number[]; note: string | null }[]> {
    const ws = TenantContext.require();
    return this.prisma.teacherPreference.findMany({
      where: { workspaceId: ws },
      orderBy: { teacherId: 'asc' },
      select: { teacherId: true, workDays: true, note: true },
    });
  }

  /**
   * `PUT /v1/schedule/skeleton` — школа вводит времена сама, дефолтов нет
   * (решение владельца №10). Отказы — именованные `SKELETON_INVALID` с причиной
   * СЛОВАМИ. Правило спаренной сетки (AR-171): части одной пары смежны, перемены
   * внутри пары нет; проверяется здесь, а не доверяется клиенту.
   */
  async setSkeleton(dto: SetSkeletonDto, actor: SchoolActor) {
    await this.state.checkVersion('schedule', dto.version);
    const ws = TenantContext.require();
    if (dto.gridKind !== 'paired' && dto.gridKind !== 'variable') {
      throw new SchoolError('SKELETON_INVALID', { reason: `неизвестный вид сетки «${dto.gridKind}»` });
    }
    const byDay = new Map<number, SkeletonPositionDto[]>();
    for (const p of dto.positions) {
      if (p.dayNo < 0 || p.dayNo > 6) throw new SchoolError('SKELETON_INVALID', { reason: `день ${p.dayNo} вне недели` });
      if (!['lesson', 'meal', 'event'].includes(p.kind)) {
        throw new SchoolError('SKELETON_INVALID', { reason: `неизвестный тип позиции «${p.kind}»` });
      }
      if (p.endMin <= p.startMin) {
        throw new SchoolError('SKELETON_INVALID', { reason: `позиция ${p.posNo} дня ${p.dayNo}: конец не позже начала` });
      }
      if (p.kind === 'lesson' && !p.lessonNo) {
        throw new SchoolError('SKELETON_INVALID', { reason: `урок в позиции ${p.posNo} дня ${p.dayNo} без номера урока` });
      }
      if (p.kind !== 'lesson' && !p.title) {
        throw new SchoolError('SKELETON_INVALID', { reason: `позиция ${p.posNo} дня ${p.dayNo} без названия` });
      }
      (byDay.get(p.dayNo) ?? byDay.set(p.dayNo, []).get(p.dayNo)!).push(p);
    }
    for (const [dayNo, list] of byDay) {
      list.sort((a, b) => a.posNo - b.posNo);
      for (let i = 1; i < list.length; i += 1) {
        if (list[i].startMin < list[i - 1].endMin) {
          throw new SchoolError('SKELETON_INVALID', {
            reason: `день ${dayNo}: позиции ${list[i - 1].posNo} и ${list[i].posNo} пересекаются по времени`,
          });
        }
      }
      const lessons = list.filter((p) => p.kind === 'lesson');
      const nos = lessons.map((p) => p.lessonNo);
      if (new Set(nos).size !== nos.length) {
        throw new SchoolError('SKELETON_INVALID', { reason: `день ${dayNo}: номера уроков повторяются` });
      }
      if (dto.gridKind === 'paired') {
        const pairs = new Map<number, SkeletonPositionDto[]>();
        for (const l of lessons) if (l.pairNo) (pairs.get(l.pairNo) ?? pairs.set(l.pairNo, []).get(l.pairNo)!).push(l);
        for (const [pairNo, parts] of pairs) {
          parts.sort((a, b) => a.startMin - b.startMin);
          for (let i = 1; i < parts.length; i += 1) {
            if (parts[i].startMin !== parts[i - 1].endMin) {
              throw new SchoolError('SKELETON_INVALID', {
                reason: `день ${dayNo}, пара ${pairNo}: между частями пары перемена — части обязаны быть смежными`,
              });
            }
          }
        }
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.skeletonPosition.deleteMany({ where: { workspaceId: ws } });
      if (dto.positions.length) {
        await tx.skeletonPosition.createMany({
          data: dto.positions.map((p) => ({
            workspaceId: ws,
            dayNo: p.dayNo,
            posNo: p.posNo,
            kind: p.kind,
            title: p.title ?? null,
            startMin: p.startMin,
            endMin: p.endMin,
            lessonNo: p.kind === 'lesson' ? p.lessonNo : null,
            pairNo: p.kind === 'lesson' ? (p.pairNo ?? null) : null,
          })),
        });
      }
      await tx.schoolState.upsert({
        where: { workspaceId: ws },
        update: { gridKind: dto.gridKind },
        create: { workspaceId: ws, gridKind: dto.gridKind },
      });
      // Версия агрегата (AR-109); сетку слотов скелет не меняет — stale нет.
      await this.state.bump(tx, 'schedule', { id: actor.userId, name: actor.name }, ws);
    });
    return { ok: true };
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
   *
   * Замены (AR-207): ключ урока не содержит педагога, поэтому урок с записью
   * `LessonSubstitution`, найденный в новом шаблоне, остаётся как есть — с
   * ТЕКУЩИМ `teacherId` (заместителем); урок без отметок, исчезающий вместе со
   * старым шаблоном, забирает свою запись замены с собой.
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
          // ссылка по значению (AR-207): запись замены уходит вместе с уроком
          await tx.lessonSubstitution.deleteMany({ where: { workspaceId: ws, lessonId: l.id } });
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
