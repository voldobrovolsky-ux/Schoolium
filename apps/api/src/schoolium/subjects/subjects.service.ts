import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ACCESS_PARAMS,
  canonicalSubjectName,
  subjectNameKey,
  type BindTeacherDto,
  type BindTeacherManualDto,
  type BindingDto,
  type CompetenceConflictDto,
  type CreateSubjectDto,
  type SaveCompetenceDto,
  type SaveCompetenceResultDto,
  type SubjectDto,
  type TokenStatus,
} from '@edustore/shared';
import { Prisma } from '@prisma/client';
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
/** Канонические написания пресета — для `canonicalSubjectName` (AR-201). */
const PRESET_NAMES = SUBJECT_PRESET.map((p) => p.name);

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
    s: { id: string; name: string; classId: string; priority: boolean; bindings: { id: string; teacherId: string; scope: string; groupNos: number[]; hoursPerWeek: number; hoursPerYear: number }[] },
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
      hoursPerYear: b.hoursPerYear,
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
      groupCount: cls?.groupCount ?? 0, // AR-202
    };
  }

  // ─────────────── мутации ───────────────

  /**
   * §11 строка 13 · `M-03`: карточка на пару «предмет × класс». Имя
   * канонизируется по ключу без регистра (AR-201): «алгебра» при существующей
   * «Алгебра» в том же классе — `SUBJECT_EXISTS` с объектом и классом, а не
   * вторая карточка. Ключ хранится в `nameKey`; уникальность до слияния прода
   * держит код, гонку двух создателей ловит P2002 тем же кодом.
   */
  async create(dto: CreateSubjectDto) {
    const ws = TenantContext.require();
    const nameKey = subjectNameKey(dto.name ?? '');
    if (!nameKey) throw new BadRequestException('Укажите название предмета');
    const cls = (await this.contingent.classes()).find((c) => c.id === dto.classId);
    if (!cls) throw new NotFoundException('класс не найден');
    const name = canonicalSubjectName(dto.name, PRESET_NAMES);
    const siblings = await this.prisma.schoolSubject.findMany({ where: { classId: dto.classId } });
    const dup = siblings.find((x) => (x.nameKey ?? subjectNameKey(x.name)) === nameKey);
    if (dup) throw new SchoolError('SUBJECT_EXISTS', { name: dup.name, classLabel: cls.label });
    try {
      const s = await this.prisma.schoolSubject.create({
        data: { workspaceId: ws, name, nameKey, classId: dto.classId },
      });
      return this.get(s.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new SchoolError('SUBJECT_EXISTS', { name, classLabel: cls.label });
      }
      throw e;
    }
  }

  /**
   * Пресет типовых предметов (AR-160): для каждого класса школы создаются
   * карточки «предмет × класс» из справочника по диапазону параллелей.
   * Идемпотентно (G-70): существующая пара ищется по КЛЮЧУ имени (AR-201) —
   * ручная «музыка» не даёт второй карточки «Музыка»; ручные карточки не
   * затираются. Ручное заведение (`S-20`/`S-21`) сохраняется — пресет
   * ускоряет, а не заменяет.
   */
  async applyPreset(): Promise<{ created: number; skipped: number }> {
    const ws = TenantContext.require();
    const [classes, existing] = await Promise.all([
      this.prisma.schoolClass.findMany(),
      this.prisma.schoolSubject.findMany({ select: { classId: true, name: true, nameKey: true } }),
    ]);
    const taken = new Set(existing.map((x) => `${x.classId}·${x.nameKey ?? subjectNameKey(x.name)}`));
    const wanted = classes.flatMap((c) =>
      SUBJECT_PRESET.filter((p) => c.parallel >= p.from && c.parallel <= p.to).map((p) => ({
        workspaceId: ws,
        name: p.name,
        nameKey: subjectNameKey(p.name),
        classId: c.id,
      })),
    );
    const rows = wanted.filter((r) => !taken.has(`${r.classId}·${r.nameKey}`));
    const res = rows.length ? await this.prisma.schoolSubject.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
    return { created: res.count, skipped: wanted.length - res.count };
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

  /**
   * §11 строка 15а · `S-21.btn.bindManual` (AR-177, УТЦ v1.4 фаза V): ручная
   * привязка из карточки предмета. QR остаётся основным каналом; ручная даёт
   * ТОТ ЖЕ `TeacherBinding` и ТО ЖЕ событие `teacher.bound.v1` — аудит и
   * подписчики не различают канал. Взаимоисключение «весь класс ↔ группы» (Д6)
   * и педагог с активной карточкой обязательны так же, как при скане.
   */
  async bindTeacherManual(subjectId: string, dto: BindTeacherManualDto, actor: SchoolActor) {
    const ws = TenantContext.require();
    const subject = await this.prisma.schoolSubject.findUnique({ where: { id: subjectId }, include: { bindings: true } });
    if (!subject) throw new NotFoundException('предмет не найден');
    if (dto.scope === 'class' && subject.bindings.some((b) => b.scope === 'group')) {
      throw new BadRequestException('у предмета уже групповые привязки — «весь класс» с ними взаимоисключён');
    }
    if (dto.scope === 'group' && subject.bindings.some((b) => b.scope === 'class')) {
      throw new BadRequestException('предмет уже привязан на весь класс — групповая привязка с этим взаимоисключена');
    }
    const membership = await this.prisma.membership.findFirst({ where: { workspaceId: ws, userId: dto.teacherId, deactivatedAt: null } });
    if (!membership) throw new NotFoundException('педагог с активным членством в школе не найден');

    const groupNos = dto.scope === 'group' ? (dto.groupNos ?? []) : [];
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherBinding.create({
        data: { workspaceId: ws, subjectId, teacherId: dto.teacherId, scope: dto.scope, groupNos },
      });
      await this.outbox.enqueue(
        tx,
        newEvent<TeacherBoundV1>({
          type: SCHOOL_EVENTS.teacherBound,
          workspaceId: ws,
          actor: actor.userId,
          payload: { subjectId, classId: subject.classId, teacherId: dto.teacherId, scope: dto.scope, groupNos },
        }),
      );
    });
    return this.get(subjectId);
  }

  /**
   * §11 строка 15б · компетенции педагога (AR-179, AR-202): модератор
   * галочками закрывает позиции «предмет × класс» — весь класс либо группы
   * (`positions[].groupNos`; при наличии `positions` список `subjectIds`
   * не читается). Снятая галочка открепляет; занятая другим позиция при
   * `replace=false` возвращается КОНФЛИКТОМ (не ошибкой — человеку задают
   * вопрос «Заменить всех?»), при `replace=true` прежние открепляются.
   * Д6 держит сервер: класс и группы на одной карточке взаимоисключены —
   * чужая классовая привязка при групповом назначении и наоборот возвращается
   * конфликтом (с `groupNo`, если конфликт по группе); replace снимает у
   * чужого ровно запрошенные группы, остальные его группы остаются.
   * События и аудит — те же `teacher.bound/unbound.v1`, канал не различим.
   */
  async saveCompetence(dto: SaveCompetenceDto, actor: SchoolActor): Promise<SaveCompetenceResultDto> {
    const ws = TenantContext.require();
    const membership = await this.prisma.membership.findFirst({
      where: { workspaceId: ws, userId: dto.teacherId, deactivatedAt: null },
    });
    if (!membership) throw new NotFoundException('педагог с активным членством в школе не найден');

    const [subjects, classes, users] = await Promise.all([
      this.prisma.schoolSubject.findMany({ include: { bindings: true } }),
      this.contingent.classes(),
      this.teachersById(),
    ]);
    const label = (classId: string) => classes.find((c) => c.id === classId)?.label ?? '—';
    const me = dto.teacherId;

    // Желаемое состояние: карточка → «весь класс» либо множество групп (AR-202).
    const desired = new Map<string, 'class' | Set<number>>();
    if (Array.isArray(dto.positions)) {
      for (const pos of dto.positions) {
        const groups = [...new Set((pos.groupNos ?? []).filter((g) => Number.isInteger(g) && g > 0))].sort((a, b) => a - b);
        desired.set(pos.subjectId, groups.length ? new Set(groups) : 'class');
      }
    } else {
      for (const id of dto.subjectIds ?? []) desired.set(id, 'class');
    }
    for (const [subjectId, want] of desired) {
      const s = subjects.find((x) => x.id === subjectId);
      if (!s) throw new NotFoundException('предмет не найден');
      if (want === 'class') continue;
      const groupCount = classes.find((c) => c.id === s.classId)?.groupCount ?? 0;
      const outside = [...want].filter((g) => g > groupCount);
      if (outside.length) {
        throw new BadRequestException(`${label(s.classId)}: группы ${outside.join(', ')} нет — в классе ${groupCount || 'нет'} групп`);
      }
    }

    interface Plan {
      subjectId: string;
      classId: string;
      /** Снять все свои привязки карточки (смена вида либо снятая галочка). */
      dropOwn: boolean;
      /** Создать свою привязку такого вида (часы — от снятых своих, если были). */
      create: { scope: 'class' | 'group'; groupNos: number[]; hoursPerYear: number; hoursPerWeek: number } | null;
      /** Чужие, которых снимает replace: педагог → 'all' либо запрошенные группы. */
      strip: Map<string, 'all' | Set<number>>;
      conflicts: { groupNo?: number; teacherIds: string[] }[];
    }
    const plans: Plan[] = [];
    const maxHours = (rows: { hoursPerYear: number; hoursPerWeek: number }[]) => ({
      hoursPerYear: Math.max(0, ...rows.map((r) => r.hoursPerYear)),
      hoursPerWeek: Math.max(0, ...rows.map((r) => r.hoursPerWeek)),
    });

    for (const s of subjects) {
      const want = desired.get(s.id);
      const own = s.bindings.filter((b) => b.teacherId === me);
      const others = s.bindings.filter((b) => b.teacherId !== me);
      const ownClass = own.some((b) => b.scope === 'class');
      const ownGroups = [...new Set(own.filter((b) => b.scope === 'group').flatMap((b) => b.groupNos))].sort((a, b) => a - b);
      const plan: Plan = { subjectId: s.id, classId: s.classId, dropOwn: false, create: null, strip: new Map(), conflicts: [] };
      const block = (b: { teacherId: string; scope: string; groupNos: number[] }, g?: number) => {
        const cur = plan.strip.get(b.teacherId);
        if (b.scope === 'class' || g === undefined) plan.strip.set(b.teacherId, 'all');
        else if (cur !== 'all') plan.strip.set(b.teacherId, new Set([...(cur ?? []), g]));
      };

      if (!want) {
        if (own.length) plan.dropOwn = true;
      } else if (want === 'class') {
        if (ownClass && !ownGroups.length) continue; // уже ведёт классом
        // «весь класс» блокирует ЛЮБАЯ чужая привязка (Д6): классовая — как прежде,
        // групповая — конфликт по каждой занятой группе
        const otherClass = others.filter((b) => b.scope === 'class');
        if (otherClass.length) plan.conflicts.push({ teacherIds: otherClass.map((b) => b.teacherId) });
        const byGroup = new Map<number, string[]>();
        for (const b of others.filter((x) => x.scope === 'group')) {
          for (const g of b.groupNos) byGroup.set(g, [...(byGroup.get(g) ?? []), b.teacherId]);
        }
        for (const [g, ids] of [...byGroup].sort((a, b) => a[0] - b[0])) plan.conflicts.push({ groupNo: g, teacherIds: ids });
        for (const b of others) block(b);
        plan.dropOwn = own.length > 0; // смена вида «группы → класс»
        plan.create = { scope: 'class', groupNos: [], ...maxHours(own) };
      } else {
        const wantArr = [...want];
        const same = !ownClass && own.length === 1 && ownGroups.length === wantArr.length && ownGroups.every((g, i) => g === wantArr[i]);
        if (same) continue;
        const adding = wantArr.filter((g) => !ownGroups.includes(g));
        // чужая классовая привязка блокирует любую группу; чужая групповая — только свою
        const otherClass = others.filter((b) => b.scope === 'class');
        for (const g of adding) {
          const holders = [
            ...otherClass.map((b) => b.teacherId),
            ...others.filter((b) => b.scope === 'group' && b.groupNos.includes(g)).map((b) => b.teacherId),
          ];
          if (holders.length) plan.conflicts.push({ groupNo: g, teacherIds: [...new Set(holders)] });
          for (const b of otherClass) block(b);
          for (const b of others.filter((x) => x.scope === 'group' && x.groupNos.includes(g))) block(b, g);
        }
        plan.dropOwn = own.length > 0;
        plan.create = { scope: 'group', groupNos: wantArr, ...maxHours(own) };
      }
      if (plan.dropOwn || plan.create || plan.conflicts.length) plans.push(plan);
    }

    const conflicts = plans.flatMap((p) => p.conflicts.map((c) => ({ ...c, subjectId: p.subjectId })));
    if (conflicts.length && !dto.replace) {
      // группировка «предмет z в классах x и y уже ведёт учитель N» — по предмету,
      // группе и составу занявших позицию педагогов; мутаций нет ни одной
      const grouped = new Map<string, CompetenceConflictDto>();
      for (const c of conflicts) {
        const subj = subjects.find((x) => x.id === c.subjectId)!;
        const names = [...new Set(c.teacherIds.map((t) => users.get(t)?.displayName ?? '—'))].sort();
        const key = `${subj.name}·${c.groupNo ?? ''}·${names.join('|')}`;
        const g = grouped.get(key) ?? { subjectName: subj.name, classLabels: [], teacherNames: names, ...(c.groupNo !== undefined ? { groupNo: c.groupNo } : {}) };
        g.classLabels.push(label(subj.classId));
        grouped.set(key, g);
      }
      return { ok: false, conflicts: [...grouped.values()], bound: 0, unbound: 0 };
    }

    let bound = 0;
    let unbound = 0;
    const unboundEvent = (subjectId: string, classId: string, teacherId: string) =>
      newEvent<TeacherUnboundV1>({
        type: SCHOOL_EVENTS.teacherUnbound,
        workspaceId: ws,
        actor: actor.userId,
        payload: { subjectId, classId, teacherId, reason: 'manual' },
      });
    const boundEvent = (subjectId: string, classId: string, teacherId: string, scope: 'class' | 'group', groupNos: number[]) =>
      newEvent<TeacherBoundV1>({
        type: SCHOOL_EVENTS.teacherBound,
        workspaceId: ws,
        actor: actor.userId,
        payload: { subjectId, classId, teacherId, scope, groupNos },
      });

    for (const p of plans) {
      await this.prisma.$transaction(async (tx) => {
        // replace: чужие снимаются ровно в запрошенном объёме — классовая привязка
        // целиком, у групповой отбираются только запрошенные группы
        for (const [teacherId, what] of p.strip) {
          const rows = await tx.teacherBinding.findMany({ where: { subjectId: p.subjectId, teacherId } });
          if (!rows.length) continue;
          const keep = what === 'all'
            ? []
            : [...new Set(rows.filter((b) => b.scope === 'group').flatMap((b) => b.groupNos))].filter((g) => !what.has(g)).sort((a, b) => a - b);
          await tx.teacherBinding.deleteMany({ where: { subjectId: p.subjectId, teacherId } });
          await this.outbox.enqueue(tx, unboundEvent(p.subjectId, p.classId, teacherId));
          unbound += 1;
          if (keep.length) {
            await tx.teacherBinding.create({
              data: { workspaceId: ws, subjectId: p.subjectId, teacherId, scope: 'group', groupNos: keep, ...maxHours(rows) },
            });
            await this.outbox.enqueue(tx, boundEvent(p.subjectId, p.classId, teacherId, 'group', keep));
            bound += 1;
          }
        }
        if (p.dropOwn) {
          await tx.teacherBinding.deleteMany({ where: { subjectId: p.subjectId, teacherId: me } });
          await this.outbox.enqueue(tx, unboundEvent(p.subjectId, p.classId, me));
          unbound += 1;
        }
        if (p.create) {
          await tx.teacherBinding.create({
            data: { workspaceId: ws, subjectId: p.subjectId, teacherId: me, ...p.create },
          });
          await this.outbox.enqueue(tx, boundEvent(p.subjectId, p.classId, me, p.create.scope, p.create.groupNos));
          bound += 1;
        }
      });
    }
    this.log.log(`компетенции ${me}: привязано ${bound}, откреплено ${unbound}`);
    return { ok: true, bound, unbound };
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
