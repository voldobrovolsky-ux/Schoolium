import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ACCESS_PARAMS,
  type BindTeacherDto,
  type BindingDto,
  type CreateSubjectDto,
  type SubjectDto,
  type TokenStatus,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent, type DomainEvent } from '../../common/events/domain-event';
import { EventBus } from '../../common/events/event-bus';
import {
  SCHOOL_EVENTS,
  type ClassDeletedV1,
  type SubjectDeletedV1,
  type TeacherBoundV1,
  type TeacherUnboundV1,
} from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';
import { SUBJECT_PRESET } from './subject-preset';
import { uncoveredGroups } from '../school-state.service';
import { ContingentContractService } from '../contingent/contingent.service';
import type { SchoolActor } from '../actor';

const MIN = 60_000;

/**
 * Предметы и привязки педагогов (`S-20`, `S-21`, `S-22`).
 *
 * Карточка заводится на ПАРУ «предмет × класс»: математика-5 и математика-6 —
 * две карточки, у каждой своя привязка и свои часы. Предмет считается закрытым,
 * когда покрытие полное: весь класс либо каждая группа имеет педагога.
 */
@Injectable()
export class SubjectsService implements OnModuleInit {
  private readonly log = new Logger('Subjects');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly bus: EventBus,
    private readonly contingent: ContingentContractService,
  ) {}

  /**
   * Удаление класса уносит карточки его предметов: карточка — это ПАРА «предмет ×
   * класс», и без класса пары не существует. Реакция оформлена подпиской, а не
   * каскадом в БД, потому что каждая исчезнувшая карточка обязана издать
   * `subject.card.deleted.v1` — иначе расписание не узнает, что покрытие изменилось.
   */
  onModuleInit(): void {
    this.bus.subscribe(SCHOOL_EVENTS.classDeleted, 'subjects', (e) => this.onClassDeleted(e));
  }

  private async onClassDeleted(e: DomainEvent): Promise<void> {
    const p = e.payload as ClassDeletedV1;
    await TenantContext.runAsSystem(async () => {
      const subjects = await this.prisma.schoolSubject.findMany({
        where: { classId: p.classId, workspaceId: e.workspaceId },
        include: { bindings: true },
      });
      for (const s of subjects) {
        await this.prisma.$transaction(async (tx) => {
          for (const b of s.bindings) {
            await this.outbox.enqueue(
              tx,
              newEvent<TeacherUnboundV1>({
                type: SCHOOL_EVENTS.teacherUnbound,
                workspaceId: e.workspaceId,
                actor: e.actor ?? 'system',
                payload: { subjectId: s.id, classId: p.classId, teacherId: b.teacherId, reason: 'class_removed' },
              }),
            );
          }
          await tx.schoolSubject.delete({ where: { id: s.id } });
          await this.outbox.enqueue(
            tx,
            newEvent<SubjectDeletedV1>({
              type: SCHOOL_EVENTS.subjectDeleted,
              workspaceId: e.workspaceId,
              actor: e.actor ?? 'system',
              payload: { subjectId: s.id, classId: p.classId },
            }),
          );
        });
      }
      if (subjects.length) this.log.log(`класс ${p.classId} удалён: снято карточек предметов — ${subjects.length}`);
    });
  }

  // ─────────────── чтение ───────────────

  async list(): Promise<SubjectDto[]> {
    const [subjects, classes, users] = await Promise.all([
      this.prisma.schoolSubject.findMany({ include: { bindings: true }, orderBy: { name: 'asc' } }),
      this.contingent.classes(),
      this.teachersById(),
    ]);
    return subjects.map((s) => this.toDto(s, classes, users));
  }

  async get(id: string): Promise<SubjectDto> {
    const s = await this.prisma.schoolSubject.findUnique({ where: { id }, include: { bindings: true } });
    if (!s) throw new NotFoundException('предмет не найден');
    return this.toDto(s, await this.contingent.classes(), await this.teachersById());
  }

  private async teachersById(): Promise<Map<string, { displayName: string; avatarUrl: string | null }>> {
    const users = await TenantContext.runAsSystem(() =>
      this.prisma.user.findMany({ select: { id: true, displayName: true, avatarUrl: true } }),
    );
    return new Map(users.map((u) => [u.id, { displayName: u.displayName, avatarUrl: u.avatarUrl }]));
  }

  private toDto(
    s: { id: string; name: string; classId: string; priority: boolean; bindings: { id: string; teacherId: string; scope: string; groupNos: number[]; hoursPerWeek: number }[] },
    classes: { id: string; label: string; groupCount: number }[],
    users: Map<string, { displayName: string; avatarUrl: string | null }>,
  ): SubjectDto {
    const cls = classes.find((c) => c.id === s.classId);
    const bindings: BindingDto[] = s.bindings.map((b) => ({
      id: b.id,
      teacherId: b.teacherId,
      teacherName: users.get(b.teacherId)?.displayName ?? '—',
      avatarUrl: users.get(b.teacherId)?.avatarUrl ?? null,
      scope: b.scope as 'class' | 'group',
      groupNos: b.groupNos,
      hoursPerWeek: b.hoursPerWeek,
    }));
    const uncovered = uncoveredGroups(
      s.id,
      cls?.groupCount ?? 0,
      s.bindings.map((b) => ({ subjectId: s.id, scope: b.scope, groupNos: b.groupNos })),
    );
    return {
      id: s.id,
      name: s.name,
      classId: s.classId,
      classLabel: cls?.label ?? '—',
      priority: s.priority,
      bindings,
      coverageComplete: uncovered.length === 0,
      uncoveredGroups: uncovered.filter((g) => g > 0),
    };
  }

  // ─────────────── мутации ───────────────

  /** §11 строка 13 · `M-03`: карточка на пару «предмет × класс». */
  async create(dto: CreateSubjectDto) {
    const ws = TenantContext.require();
    const s = await this.prisma.schoolSubject.create({
      data: { workspaceId: ws, name: dto.name.trim(), classId: dto.classId },
    });
    return this.get(s.id);
  }

  /**
   * Пресет типовых предметов (AR-160): для каждого класса школы создаются
   * карточки «предмет × класс» из справочника по диапазону параллелей.
   * Идемпотентно (G-70): существующая пара не дублируется (`skipDuplicates` по
   * уникальности `[workspaceId, name, classId]`), ручные карточки не
   * затираются. Ручное заведение (`S-20`/`S-21`) сохраняется — пресет
   * ускоряет, а не заменяет.
   */
  async applyPreset(): Promise<{ created: number; skipped: number }> {
    const ws = TenantContext.require();
    const classes = await this.prisma.schoolClass.findMany();
    const rows = classes.flatMap((c) =>
      SUBJECT_PRESET.filter((p) => c.parallel >= p.from && c.parallel <= p.to).map((p) => ({
        workspaceId: ws,
        name: p.name,
        classId: c.id,
      })),
    );
    const res = await this.prisma.schoolSubject.createMany({ data: rows, skipDuplicates: true });
    return { created: res.count, skipped: rows.length - res.count };
  }

  /**
   * §11 строка 28 · `S-21.btn.deleteSubject`: удаление доступно, когда педагог не
   * привязан либо привязки сняты. Обратной операции нет: карточка уходит вместе с
   * часами нагрузки и историей привязок, педагоги остаются (AR-105).
   */
  async remove(id: string, actor: SchoolActor) {
    const s = await this.prisma.schoolSubject.findUnique({ where: { id }, include: { bindings: true } });
    if (!s) throw new NotFoundException('предмет не найден');
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolSubject.delete({ where: { id } });
      await this.outbox.enqueue(
        tx,
        newEvent<SubjectDeletedV1>({
          type: SCHOOL_EVENTS.subjectDeleted,
          workspaceId: ws,
          actor: actor.userId,
          payload: { subjectId: id, classId: s.classId },
        }),
      );
    });
    return { ok: true };
  }

  // ─────────────── QR привязки педагога (`S-22`, AR-87) ───────────────

  /** §11 строка 14: одноразовый токен, 5 минут, гаснет при закрытии карточки. */
  async createBindToken(subjectId: string) {
    const ws = TenantContext.require();
    const t = await this.prisma.activationToken.create({
      data: {
        workspaceId: ws,
        token: randomBytes(20).toString('hex'),
        purpose: 'subject_bind',
        targetId: subjectId,
        roles: [],
        expiresAt: new Date(Date.now() + ACCESS_PARAMS.bindTokenTtlMinutes * MIN),
      },
    });
    return { token: t.token, status: 'waiting' as TokenStatus, expiresAt: t.expiresAt.toISOString() };
  }

  /**
   * Поллинг раз в 2 секунды, пока карточка открыта (AR-87): статус токена и, после
   * скана, идентичность сканировавшего. WebSocket в 1.1.1 не вводится.
   */
  async bindTokenStatus(subjectId: string) {
    const t = await this.prisma.activationToken.findFirst({
      where: { purpose: 'subject_bind', targetId: subjectId },
      orderBy: { createdAt: 'desc' },
    });
    if (!t) return { status: 'expired' as TokenStatus };
    if (t.state === 'used') return { status: 'used' as TokenStatus };
    if (t.expiresAt < new Date()) return { status: 'expired' as TokenStatus };
    if (t.state === 'scanned') {
      const u = t.scannedBy
        ? await TenantContext.runAsSystem(() => this.prisma.user.findUnique({ where: { id: t.scannedBy! } }))
        : null;
      return { status: 'scanned' as TokenStatus, scannedByName: u?.displayName ?? null, scannedById: t.scannedBy };
    }
    return { status: 'waiting' as TokenStatus };
  }

  /** `S-70`: педагог сканирует QR из личного кабинета — карточка модератора узнаёт. */
  async scan(token: string, actor: SchoolActor) {
    const t = await this.prisma.activationToken.findUnique({ where: { token } });
    if (!t || t.purpose !== 'subject_bind') throw new SchoolError('TOKEN_EXPIRED');
    if (t.state === 'used') throw new SchoolError('TOKEN_USED');
    if (t.expiresAt < new Date()) throw new SchoolError('TOKEN_EXPIRED');
    await this.prisma.activationToken.update({
      where: { id: t.id },
      data: { state: 'scanned', scannedBy: actor.userId },
    });
    const subject = await this.prisma.schoolSubject.findUnique({ where: { id: t.targetId } });
    const classes = await this.contingent.classes();
    const cls = classes.find((c) => c.id === subject?.classId);
    return { ok: true, subject: subject?.name ?? '', classLabel: cls?.label ?? '' };
  }

  /**
   * §11 строка 15 · `S-22.btn.confirm`: привязка. «Весь класс» и групповые
   * привязки одного предмета ВЗАИМОИСКЛЮЧАЕМЫ (Д6). Токен гасится первой
   * успешной операцией — второй скан получает `TOKEN_USED` (AR-109).
   */
  async bindTeacher(subjectId: string, dto: BindTeacherDto, actor: SchoolActor) {
    const ws = TenantContext.require();
    const t = await this.prisma.activationToken.findUnique({ where: { token: dto.token } });
    if (!t || t.purpose !== 'subject_bind' || t.targetId !== subjectId) throw new SchoolError('TOKEN_EXPIRED');
    if (t.state === 'used') throw new SchoolError('TOKEN_USED');
    if (t.expiresAt < new Date()) throw new SchoolError('TOKEN_EXPIRED');
    if (!t.scannedBy) throw new SchoolError('TOKEN_EXPIRED');

    const subject = await this.prisma.schoolSubject.findUnique({ where: { id: subjectId }, include: { bindings: true } });
    if (!subject) throw new NotFoundException('предмет не найден');
    if (dto.scope === 'class' && subject.bindings.some((b) => b.scope === 'group')) {
      throw new SchoolError('TOKEN_EXPIRED');
    }
    if (dto.scope === 'group' && subject.bindings.some((b) => b.scope === 'class')) {
      throw new SchoolError('TOKEN_EXPIRED');
    }

    const teacherId = t.scannedBy;
    const groupNos = dto.scope === 'group' ? (dto.groupNos ?? []) : [];
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherBinding.create({
        data: { workspaceId: ws, subjectId, teacherId, scope: dto.scope, groupNos },
      });
      await tx.activationToken.update({ where: { id: t.id }, data: { state: 'used', usedAt: new Date() } });
      await this.outbox.enqueue(
        tx,
        newEvent<TeacherBoundV1>({
          type: SCHOOL_EVENTS.teacherBound,
          workspaceId: ws,
          actor: actor.userId,
          payload: { subjectId, classId: subject.classId, teacherId, scope: dto.scope, groupNos },
        }),
      );
    });
    return this.get(subjectId);
  }

  /** §11 строка 16 · `S-21.btn.unbind`: открепление. Обратная — привязать заново. */
  async unbind(subjectId: string, teacherId: string, actor: SchoolActor) {
    const subject = await this.prisma.schoolSubject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new NotFoundException('предмет не найден');
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherBinding.deleteMany({ where: { subjectId, teacherId } });
      await this.outbox.enqueue(
        tx,
        newEvent<TeacherUnboundV1>({
          type: SCHOOL_EVENTS.teacherUnbound,
          workspaceId: ws,
          actor: actor.userId,
          payload: { subjectId, classId: subject.classId, teacherId, reason: 'manual' },
        }),
      );
    });
    return this.get(subjectId);
  }

  /** Приоритеты (`S-41` экран 3): «в начало дня» — свойство карточки предмета. */
  async setPriorities(subjectIds: string[]): Promise<void> {
    await this.prisma.schoolSubject.updateMany({ data: { priority: false } });
    if (subjectIds.length) {
      await this.prisma.schoolSubject.updateMany({ where: { id: { in: subjectIds } }, data: { priority: true } });
    }
  }
}

/**
 * Публичный ЧИТАЮЩИЙ контракт предметов: нагрузка и генератор спрашивают
 * покрытие и часы здесь, а не запросом в таблицы модуля.
 */
@Injectable()
export class SubjectsContractService {
  constructor(private readonly prisma: PrismaService) {}

  subjectsWithBindings() {
    return this.prisma.schoolSubject.findMany({ include: { bindings: true } });
  }

  bindings() {
    return this.prisma.teacherBinding.findMany();
  }

  /** Снятие всех привязок сотрудника — каскад удаления и деактивации (AR-89). */
  async unbindAllOfTeacher(teacherId: string): Promise<{ subjectId: string; classId: string }[]> {
    const bindings = await this.prisma.teacherBinding.findMany({ where: { teacherId } });
    if (!bindings.length) return [];
    const subjects = await this.prisma.schoolSubject.findMany({
      where: { id: { in: bindings.map((b) => b.subjectId) } },
      select: { id: true, classId: true },
    });
    await this.prisma.teacherBinding.deleteMany({ where: { teacherId } });
    return subjects.map((s) => ({ subjectId: s.id, classId: s.classId }));
  }

  hasBindings(teacherId: string): Promise<number> {
    return this.prisma.teacherBinding.count({ where: { teacherId } });
  }
}
