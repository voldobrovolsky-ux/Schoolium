import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  LESSON_CANCEL_REASONS,
  ROLE_PERMISSIONS,
  subjectNameKey,
  type CancelLessonDto,
  type DatedLessonDto,
  type LessonCancelReason,
  type LessonSubstitutionDto,
  type LessonSubstitutionStatus,
  type SchoolPermission,
  type SetSubstituteDto,
  type SubstitutionResultDto,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import {
  SCHOOL_EVENTS,
  type LessonCancelledV1,
  type LessonReassignedV1,
  type LessonRestoredV1,
} from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';
import type { SchoolActor } from '../actor';
import { ContingentContractService } from '../contingent/contingent.service';
import { SubjectsContractService } from '../subjects/subjects.service';
import { assertLessonNotHeld, dayNoOf, isoDayOf } from './lesson-time';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/** Свободный текст причины читают только штатные роли с одним из этих прав (AR-207). */
const REASON_READERS: SchoolPermission[] = ['staff.manage', 'schedule.build', 'school.oversee'];

/** Право действующего — по пакету его ролей из контракта (тот же источник, что у каталога). */
export const actorHas = (actor: Pick<SchoolActor, 'roles'>, code: SchoolPermission): boolean =>
  actor.roles.some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(code));

type Lesson = {
  id: string;
  date: Date;
  slotNo: number;
  classId: string;
  groupNo: number;
  subjectId: string;
  teacherId: string;
  detachedAt: Date | null;
};

/**
 * Отмена урока педагогом и замена (AR-207; вытесняет AR-145 в части «вместо
 * замены — слот следующей недели»).
 *
 * Фактический ведущий урока живёт в `SchoolLesson.teacherId`: при замене он
 * переписывается на заместителя, исходный педагог хранится в записи
 * `LessonSubstitution` (одна на урок). Журнал узнаёт о новом педагоге, отмене
 * и её отзыве ТОЛЬКО событиями (`reassigned` / `cancelled` / `restored`), а не
 * чтением таблиц расписания — иначе заместитель не прошёл бы гейт отметки
 * (красная линия 5, AR-74).
 *
 * Подбор заместителя — по данным, которые в школе есть: активные педагоги
 * ранга 1 (привязка к тому же предмету) и ранга 2 (тот же ключ имени предмета в
 * другом классе), свободные в слот и работающие в этот день (AR-206). Педагог
 * другой дисциплины не назначается — узел владельца AR-209.
 */
@Injectable()
export class SubstitutionService {
  private readonly log = new Logger('Substitution');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly subjects: SubjectsContractService,
    private readonly contingent: ContingentContractService,
  ) {}

  // ─────────────── чтение: датированный оверлей недели (`S-40`) ───────────────

  /**
   * `GET /v1/schedule/lessons?from&to[&classId][&teacherId]` → `DatedLessonDto[]`.
   * Фильтр по педагогу включает и уроки, которые у него ЗАБРАЛА замена: в его
   * неделе они стоят с маркером «Замена: Фамилия И.», а не исчезают молча.
   */
  async listLessons(
    from: string,
    to: string,
    filter: { classId?: string; teacherId?: string },
    actor: SchoolActor,
  ): Promise<DatedLessonDto[]> {
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) throw new BadRequestException('from и to — даты вида YYYY-MM-DD');
    if (from > to) throw new BadRequestException('from позже to');
    const lessons: Lesson[] = await this.prisma.schoolLesson.findMany({
      where: {
        date: { gte: parseDay(from), lte: parseDay(to) },
        ...(filter.classId ? { classId: filter.classId } : {}),
      },
      orderBy: [{ date: 'asc' }, { slotNo: 'asc' }, { classId: 'asc' }, { groupNo: 'asc' }],
    });
    if (!lessons.length) return [];

    const subs = await this.prisma.lessonSubstitution.findMany({
      where: { lessonId: { in: lessons.map((l) => l.id) }, status: { not: 'withdrawn' } },
    });
    const subByLesson = new Map(subs.map((s) => [s.lessonId, s]));
    const visible = filter.teacherId
      ? lessons.filter((l) => l.teacherId === filter.teacherId || subByLesson.get(l.id)?.originalTeacherId === filter.teacherId)
      : lessons;

    const [classes, subjects, names] = await Promise.all([
      this.contingent.classes(),
      this.subjects.subjectsWithBindings(),
      this.namesOf([
        ...visible.map((l) => l.teacherId),
        ...subs.flatMap((s) => [s.originalTeacherId, s.substituteTeacherId ?? '']),
      ]),
    ]);
    const classLabel = new Map(classes.map((c) => [c.id, c.label]));
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const seesReason = REASON_READERS.some((p) => actorHas(actor, p));

    return visible.map((l) => {
      const s = subByLesson.get(l.id);
      const substitution: LessonSubstitutionDto | null = s
        ? {
            status: s.status as LessonSubstitutionStatus,
            originalTeacherId: s.originalTeacherId,
            originalTeacherName: names.get(s.originalTeacherId) ?? '—',
            substituteTeacherId: s.substituteTeacherId,
            substituteTeacherName: s.substituteTeacherId ? (names.get(s.substituteTeacherId) ?? '—') : null,
            reason: s.reason as LessonCancelReason,
            reasonText: seesReason ? s.reasonText : null,
          }
        : null;
      return {
        lessonId: l.id,
        date: isoDayOf(l.date),
        slotNo: l.slotNo,
        classId: l.classId,
        classLabel: classLabel.get(l.classId) ?? '—',
        groupNo: l.groupNo === 0 ? null : l.groupNo,
        subjectId: l.subjectId,
        subjectName: subjectName.get(l.subjectId) ?? '—',
        teacherId: l.teacherId,
        teacherName: names.get(l.teacherId) ?? '—',
        detached: l.detachedAt !== null,
        substitution,
      };
    });
  }

  // ─────────────── §11 строка 54 · `M-31`: отмена своего урока ───────────────

  /**
   * Педагог отменяет СВОЙ урок (`lesson.cancel.self`; строитель с
   * `schedule.build` — любой). Порядок проверок: принадлежность → урок вне
   * расписания → уже отменён → уже начался. Затем автоподбор: заместитель
   * найден — урок переписан на него и издано `reassigned`; нет — `cancelled`.
   */
  async cancel(lessonId: string, actor: SchoolActor, dto: CancelLessonDto): Promise<SubstitutionResultDto> {
    const reason = dto?.reason;
    if (!LESSON_CANCEL_REASONS.includes(reason)) {
      throw new BadRequestException(`Причина отмены — одна из: ${LESSON_CANCEL_REASONS.join(', ')}`);
    }
    const reasonText = typeof dto.reasonText === 'string' && dto.reasonText.trim() ? dto.reasonText.trim().slice(0, 500) : null;
    const ws = TenantContext.require();
    const lesson = await this.lesson(lessonId);
    const existing = await this.prisma.lessonSubstitution.findUnique({ where: { lessonId } });
    const active = existing && existing.status !== 'withdrawn' ? existing : null;
    // «Свой» урок — тот, который педагог ведёт, либо который у него забрала
    // замена: повторная отмена уже заменённого урока — `LESSON_CANCELLED`, а не «чужой».
    const own = lesson.teacherId === actor.userId || active?.originalTeacherId === actor.userId;
    if (!actorHas(actor, 'schedule.build') && !own) {
      throw new SchoolError('NOT_YOUR_LESSON', { teacher: await this.nameOf(active?.originalTeacherId ?? lesson.teacherId) });
    }
    if (lesson.detachedAt) throw new SchoolError('LESSON_DETACHED');
    if (active) throw new SchoolError('LESSON_CANCELLED');
    await assertLessonNotHeld(this.prisma, ws, lesson);

    const pick = await this.pickSubstitute(lesson, ws);
    const now = new Date();
    const data = {
      originalTeacherId: lesson.teacherId,
      substituteTeacherId: pick?.teacherId ?? null,
      reason,
      reasonText,
      status: pick ? 'substituted' : 'no_substitute',
      requestedBy: actor.userId,
      requestedAt: now,
      decidedAt: now,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.lessonSubstitution.upsert({ where: { lessonId }, update: data, create: { workspaceId: ws, lessonId, ...data } });
      if (pick) {
        await tx.schoolLesson.update({ where: { id: lessonId }, data: { teacherId: pick.teacherId } });
        await this.outbox.enqueue(
          tx,
          newEvent<LessonReassignedV1>({
            type: SCHOOL_EVENTS.lessonReassigned,
            workspaceId: ws,
            actor: actor.userId,
            payload: { lessonId, date: isoDayOf(lesson.date), fromTeacherId: lesson.teacherId, toTeacherId: pick.teacherId, reason },
          }),
        );
      } else {
        await this.outbox.enqueue(
          tx,
          newEvent<LessonCancelledV1>({
            type: SCHOOL_EVENTS.lessonCancelled,
            workspaceId: ws,
            actor: actor.userId,
            payload: {
              lessonId,
              date: isoDayOf(lesson.date),
              slotNo: lesson.slotNo,
              classId: lesson.classId,
              groupNo: lesson.groupNo === 0 ? null : lesson.groupNo,
              subjectId: lesson.subjectId,
              teacherId: lesson.teacherId,
              reason,
            },
          }),
        );
      }
    });
    this.log.log(pick ? `урок ${lessonId}: замена ${pick.name}` : `урок ${lessonId}: замены нет`);
    return {
      status: pick ? 'substituted' : 'no_substitute',
      substituteTeacherId: pick?.teacherId ?? null,
      substituteTeacherName: pick?.name ?? null,
    };
  }

  // ─────────────── §11 строка 55: отзыв отмены ───────────────

  /**
   * Отзыв — обратимость (AR-90): своё отзывает исходный педагог, любое —
   * строитель. Замена снимается тем же `reassigned` обратно на исходного
   * педагога; отмена без замены — `restored`, и журнал снимает `cancelledAt`.
   * Гейта времени здесь нет намеренно (§11 строка 55 кодов времени не несёт).
   */
  async withdraw(lessonId: string, actor: SchoolActor): Promise<{ ok: true }> {
    const ws = TenantContext.require();
    const lesson = await this.lesson(lessonId);
    const sub = await this.prisma.lessonSubstitution.findUnique({ where: { lessonId } });
    if (!sub || sub.status === 'withdrawn') throw new NotFoundException('у урока нет действующей отмены или замены');
    if (!actorHas(actor, 'schedule.build') && sub.originalTeacherId !== actor.userId) {
      throw new SchoolError('NOT_YOUR_LESSON', { teacher: await this.nameOf(sub.originalTeacherId) });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.lessonSubstitution.update({ where: { lessonId }, data: { status: 'withdrawn', decidedAt: new Date() } });
      if (sub.status === 'substituted') {
        await tx.schoolLesson.update({ where: { id: lessonId }, data: { teacherId: sub.originalTeacherId } });
        await this.outbox.enqueue(
          tx,
          newEvent<LessonReassignedV1>({
            type: SCHOOL_EVENTS.lessonReassigned,
            workspaceId: ws,
            actor: actor.userId,
            payload: { lessonId, date: isoDayOf(lesson.date), fromTeacherId: lesson.teacherId, toTeacherId: sub.originalTeacherId, reason: 'withdrawn' },
          }),
        );
      } else {
        await this.outbox.enqueue(
          tx,
          newEvent<LessonRestoredV1>({
            type: SCHOOL_EVENTS.lessonRestored,
            workspaceId: ws,
            actor: actor.userId,
            payload: { lessonId, date: isoDayOf(lesson.date) },
          }),
        );
      }
    });
    return { ok: true };
  }

  // ─────────────── §11 строка 56 · `S-40.select.substitute`: ручная замена ───────────────

  /**
   * Строитель (`schedule.build`) назначает или переназначает заместителя сам.
   * Рабочие дни педагога здесь не фильтр — решение человека, а не автоподбора;
   * занятость в слоте — по-прежнему отказ `SUBSTITUTE_BUSY` с фамилией и классом.
   */
  async setSubstitute(lessonId: string, actor: SchoolActor, dto: SetSubstituteDto): Promise<SubstitutionResultDto> {
    const teacherId = String(dto?.teacherId ?? '').trim();
    if (!teacherId) throw new BadRequestException('teacherId обязателен');
    const ws = TenantContext.require();
    const lesson = await this.lesson(lessonId);
    if (lesson.detachedAt) throw new SchoolError('LESSON_DETACHED');
    await assertLessonNotHeld(this.prisma, ws, lesson);

    // Membership — справочник вне tenant-guard: фильтр по школе явный.
    const member = await this.prisma.membership.findFirst({
      where: { workspaceId: ws, userId: teacherId, deactivatedAt: null, roles: { has: 'teacher' } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('педагог с активным членством в школе не найден');

    const sub = await this.prisma.lessonSubstitution.findUnique({ where: { lessonId } });
    const active = sub && sub.status !== 'withdrawn' ? sub : null;
    const original = active ? active.originalTeacherId : lesson.teacherId;
    if (teacherId === original) {
      if (!active) throw new BadRequestException('этот педагог и так ведёт урок');
      throw new BadRequestException('это исходный педагог урока — верните урок ему отзывом отмены (DELETE /lessons/:id/cancel)');
    }
    const name = await this.nameOf(teacherId);
    if (active?.status === 'substituted' && active.substituteTeacherId === teacherId) {
      return { status: 'substituted', substituteTeacherId: teacherId, substituteTeacherName: name };
    }

    const busy = await this.prisma.schoolLesson.findFirst({
      where: { date: lesson.date, slotNo: lesson.slotNo, teacherId, detachedAt: null, id: { not: lesson.id } },
      select: { classId: true },
    });
    if (busy) {
      const classes = await this.contingent.classes();
      throw new SchoolError('SUBSTITUTE_BUSY', { teacher: name, classLabel: classes.find((c) => c.id === busy.classId)?.label ?? '—' });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.lessonSubstitution.upsert({
        where: { lessonId },
        update: { substituteTeacherId: teacherId, status: 'substituted', decidedAt: now, ...(active ? {} : { originalTeacherId: original, reason: 'other', reasonText: null, requestedBy: actor.userId, requestedAt: now }) },
        create: {
          workspaceId: ws,
          lessonId,
          originalTeacherId: original,
          substituteTeacherId: teacherId,
          reason: 'other',
          reasonText: null,
          status: 'substituted',
          requestedBy: actor.userId,
          requestedAt: now,
          decidedAt: now,
        },
      });
      await tx.schoolLesson.update({ where: { id: lessonId }, data: { teacherId } });
      await this.outbox.enqueue(
        tx,
        newEvent<LessonReassignedV1>({
          type: SCHOOL_EVENTS.lessonReassigned,
          workspaceId: ws,
          actor: actor.userId,
          payload: { lessonId, date: isoDayOf(lesson.date), fromTeacherId: lesson.teacherId, toTeacherId: teacherId, reason: 'manual' },
        }),
      );
    });
    return { status: 'substituted', substituteTeacherId: teacherId, substituteTeacherName: name };
  }

  // ─────────────── автоподбор (AR-207) ───────────────

  /**
   * Кандидаты — активные членства с ролью `teacher`, кроме отсутствующего.
   * Ранг 1: привязка к тому же предмету; ранг 2: привязка к предмету с тем же
   * ключом имени в другом классе (AR-201). Фильтры: свободен в слот (нет урока
   * той же даты и позиции — педагог второй группы спаренного часа занят
   * автоматически), рабочие дни (`TeacherPreference.workDays`, если заданы).
   * Тай-брейк: меньше уроков в этот день → меньше недельных часов → имя.
   */
  private async pickSubstitute(lesson: Lesson, ws: string): Promise<{ teacherId: string; name: string } | null> {
    const subjects = await this.subjects.subjectsWithBindings();
    const own = subjects.find((s) => s.id === lesson.subjectId);
    if (!own) return null;
    const key = own.nameKey ?? subjectNameKey(own.name);
    const rank = new Map<string, 1 | 2>();
    for (const s of subjects) {
      const r: 1 | 2 | null = s.id === own.id ? 1 : (s.nameKey ?? subjectNameKey(s.name)) === key ? 2 : null;
      if (r === null) continue;
      for (const b of s.bindings) {
        if (b.teacherId === lesson.teacherId) continue;
        const prev = rank.get(b.teacherId);
        if (prev === undefined || r < prev) rank.set(b.teacherId, r);
      }
    }
    if (!rank.size) return null;

    const members = await this.prisma.membership.findMany({
      where: { workspaceId: ws, userId: { in: [...rank.keys()] }, deactivatedAt: null, roles: { has: 'teacher' } },
      select: { userId: true },
    });
    const active = new Set(members.map((m) => m.userId ?? ''));
    const busy = new Set(
      (
        await this.prisma.schoolLesson.findMany({
          where: { date: lesson.date, slotNo: lesson.slotNo, detachedAt: null, id: { not: lesson.id } },
          select: { teacherId: true },
        })
      ).map((l) => l.teacherId),
    );
    const dayNo = dayNoOf(lesson.date);
    const prefs = await this.prisma.teacherPreference.findMany({ where: { teacherId: { in: [...rank.keys()] } } });
    const worksThatDay = new Map(prefs.map((p) => [p.teacherId, p.workDays.length === 0 || p.workDays.includes(dayNo)]));

    const candidates = [...rank.keys()].filter((t) => active.has(t) && !busy.has(t) && (worksThatDay.get(t) ?? true));
    if (!candidates.length) return null;

    const dayLoad = new Map<string, number>();
    for (const l of await this.prisma.schoolLesson.findMany({
      where: { date: lesson.date, detachedAt: null, teacherId: { in: candidates } },
      select: { teacherId: true },
    })) {
      dayLoad.set(l.teacherId, (dayLoad.get(l.teacherId) ?? 0) + 1);
    }
    const weekHours = new Map<string, number>();
    for (const s of subjects) for (const b of s.bindings) weekHours.set(b.teacherId, (weekHours.get(b.teacherId) ?? 0) + b.hoursPerWeek);
    const names = await this.namesOf(candidates);

    candidates.sort((a, b) =>
      (rank.get(a) ?? 2) - (rank.get(b) ?? 2) ||
      (dayLoad.get(a) ?? 0) - (dayLoad.get(b) ?? 0) ||
      (weekHours.get(a) ?? 0) - (weekHours.get(b) ?? 0) ||
      (names.get(a) ?? '').localeCompare(names.get(b) ?? '', 'ru'),
    );
    const best = candidates[0];
    return { teacherId: best, name: names.get(best) ?? '—' };
  }

  // ─────────────── вспомогательное ───────────────

  private async lesson(id: string): Promise<Lesson> {
    const l = await this.prisma.schoolLesson.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('урок не найден');
    return l;
  }

  /** Имена — из справочника пользователей вне tenant-guard, как в `ScheduleService.load`. */
  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const users = await TenantContext.runAsSystem(() =>
      this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, displayName: true } }),
    );
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  private async nameOf(id: string): Promise<string> {
    return (await this.namesOf([id])).get(id) ?? '—';
  }
}
