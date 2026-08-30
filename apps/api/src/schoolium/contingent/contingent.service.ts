import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ClassDto, CreateClassesDto, StudentDto, UpsertStudentDto } from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import {
  SCHOOL_EVENTS,
  type ClassCreatedV1,
  type ClassDeletedV1,
  type StudentDeactivatedV1,
  type StudentDeletedV1,
  type StudentReactivatedV1,
  type StudentUpsertedV1,
} from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';
import { SchoolStateService } from '../school-state.service';
import { JournalContractService } from '../journal/journal.service';
import type { SchoolActor } from '../actor';

/** «ё» приравнивается к «е»; сравнение Фамилия → Имя → Отчество (`localeCompare('ru')`). */
const norm = (s: string | null): string => (s ?? '').toLowerCase().replace(/ё/g, 'е');
const byName = (a: { lastName: string; firstName: string; middleName: string | null },
                b: { lastName: string; firstName: string; middleName: string | null }): number =>
  norm(a.lastName).localeCompare(norm(b.lastName), 'ru') ||
  norm(a.firstName).localeCompare(norm(b.firstName), 'ru') ||
  norm(a.middleName).localeCompare(norm(b.middleName), 'ru');

const isFilled = (s: { lastName: string; firstName: string }): boolean => s.lastName !== '' && s.firstName !== '';

/**
 * Контингент — СЕРВИС-ВЛАДЕЛЕЦ данных об учениках, классах и группах (AR-45).
 * Остальные модули читают его через контракт и события; прямой SQL в его таблицы
 * запрещён (красная линия 5).
 */
@Injectable()
export class ContingentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly state: SchoolStateService,
    private readonly journal: JournalContractService,
  ) {}

  // ─────────────── чтение ───────────────

  async listClasses(): Promise<ClassDto[]> {
    const classes = await this.prisma.schoolClass.findMany({
      orderBy: [{ parallel: 'asc' }, { letter: 'asc' }],
      include: { students: true },
    });
    return Promise.all(classes.map((c) => this.toClassDto(c)));
  }

  async getClass(id: string): Promise<ClassDto> {
    const c = await this.prisma.schoolClass.findUnique({ where: { id }, include: { students: true } });
    if (!c) throw new NotFoundException('класс не найден');
    return this.toClassDto(c);
  }

  private async toClassDto(c: { id: string; parallel: number; letter: string | null; label: string; groupCount: number; students: { lastName: string; firstName: string }[] }): Promise<ClassDto> {
    return {
      id: c.id,
      parallel: c.parallel,
      letter: c.letter,
      label: c.label,
      groupCount: c.groupCount,
      students: c.students.length,
      // `M-13` называет ЗАПОЛНЕННЫЕ профили отдельно от пустых (AR-105): в
      // единственном опасном случае (профили заполнены, отметок ещё нет) текст
      // «15 пустых профилей» сообщал бы человеку обратное тому, что происходит.
      filledProfiles: c.students.filter(isFilled).length,
      totalProfiles: c.students.length,
      hasMarks: await this.journal.classHasMarks(c.id),
    };
  }

  async listStudents(classId: string): Promise<StudentDto[]> {
    const [cls, students] = await Promise.all([
      this.prisma.schoolClass.findUnique({ where: { id: classId } }),
      this.prisma.schoolStudent.findMany({ where: { classId }, include: { group: true } }),
    ]);
    if (!cls) throw new NotFoundException('класс не найден');
    // до заполнения ФИО сортировать нечем — пустые профили идут в порядке создания
    const filled = students.filter(isFilled).sort(byName);
    const empty = students.filter((s) => !isFilled(s)).sort((a, b) => a.seq - b.seq);
    return Promise.all([...filled, ...empty].map((s) => this.toStudentDto(s)));
  }

  async getStudent(id: string): Promise<StudentDto> {
    const s = await this.prisma.schoolStudent.findUnique({ where: { id }, include: { group: true } });
    if (!s) throw new NotFoundException('ученик не найден');
    return this.toStudentDto(s);
  }

  private async toStudentDto(s: {
    id: string; classId: string; lastName: string; firstName: string; middleName: string | null;
    sex: string | null; deactivatedAt: Date | null; group?: { groupNo: number } | null;
  }): Promise<StudentDto> {
    return {
      id: s.id,
      classId: s.classId,
      lastName: s.lastName,
      firstName: s.firstName,
      middleName: s.middleName,
      sex: (s.sex as 'm' | 'f' | null) ?? null,
      groupNo: s.group?.groupNo ?? null,
      deactivated: s.deactivatedAt !== null,
      // правило подмены кнопки решает сервер, а не интерфейс (AR-78)
      hasMarks: await this.journal.studentHasMarks(s.id),
      filled: isFilled(s),
    };
  }

  // ─────────────── мастер создания классов (§11 строка 8) ───────────────

  /**
   * `S-11`, пять шагов. Каждый опциональный параметр имеет ЯВНУЮ кнопку отказа
   * (AR-77): `letters === null` — «⌀ Без литер», `groups === null` — «⌀ Без
   * групп». Невыбранность далее не пускает, и пустое поле выбором не считается.
   */
  async createClasses(dto: CreateClassesDto, actor: SchoolActor) {
    const ws = TenantContext.require();
    // Границы шагов — тексты из таблицы `S-11` (`70-screens.md`), дословно: это
    // валидация ввода, а не отказ из реестра §9, и подменять её кодом оттуда
    // означало бы показать человеку сообщение не про то, что он сделал.
    if (dto.parallels < 1 || dto.parallels > 11) throw new BadRequestException('Укажите от 1 до 11');
    if (dto.studentsPerClass < 1 || dto.studentsPerClass > 40) throw new BadRequestException('Укажите от 1 до 40');
    // групп не больше, чем учеников: иначе появляется группа без единого ученика,
    // и генератор планирует урок в пустоту (эталон `wizard.groupsFit`)
    if (dto.groups !== null && (dto.groups < 2 || dto.groups > 4)) {
      throw new BadRequestException('Групп может быть от 2 до 4');
    }
    if (dto.groups !== null && dto.groups > dto.studentsPerClass) {
      throw new BadRequestException('Групп не больше, чем учеников: в классе из 1 ученика деления нет');
    }
    if (dto.sexCount < 0 || dto.sexCount > dto.studentsPerClass) {
      throw new BadRequestException('Не больше численности класса');
    }
    // Поклассные численности проверяются теми же границами и теми же текстами:
    // человек правит строку таблицы и должен получить отказ про эту строку, а
    // не общий «неверные данные».
    for (const row of dto.perClass ?? []) {
      if (row.students < 1 || row.students > 40) throw new BadRequestException(`${row.label}: укажите от 1 до 40`);
      if (row.sexCount < 0 || row.sexCount > row.students) {
        throw new BadRequestException(`${row.label}: не больше численности класса`);
      }
      if (dto.groups !== null && dto.groups > row.students) {
        throw new BadRequestException(`${row.label}: групп не больше, чем учеников`);
      }
    }

    if ((await this.prisma.schoolClass.count()) > 0) throw new SchoolError('CLASSES_ALREADY_EXIST');
    await this.state.checkVersion('contingent', dto.version);

    const letters = dto.letters && dto.letters.length ? dto.letters : [null];
    // Строки таблицы кладутся под имя класса — сервер собирает то же имя, что
    // показал мастер, и сопоставление не зависит от порядка строк.
    const overrides = new Map((dto.perClass ?? []).map((r) => [r.label, r]));
    const headcount = (label: string) => {
      const row = overrides.get(label);
      const students = row ? row.students : dto.studentsPerClass;
      const sexCount = row ? row.sexCount : dto.sexCount;
      return { students, boys: dto.sexKind === 'boys' ? sexCount : students - sexCount };
    };

    await this.prisma.$transaction(async (tx) => {
      for (let p = 1; p <= dto.parallels; p += 1) {
        for (const letter of letters) {
          const label = letter ? `${p}${letter}` : String(p);
          const { students, boys } = headcount(label);
          const cls = await tx.schoolClass.create({
            data: {
              workspaceId: ws,
              parallel: p,
              letter,
              label,
              groupCount: dto.groups ?? 0,
              plannedStudents: students,
            },
          });
          for (let g = 1; g <= (dto.groups ?? 0); g += 1) {
            await tx.studentGroup.create({
              data: { workspaceId: ws, classId: cls.id, groupNo: g, name: `Группа ${g}` },
            });
          }
          // Пустые профили заводятся сразу, но пол уже известен из шага 5 мастера:
          // иначе собранное там число не влияло бы ни на что. ФИО остаются пустыми —
          // именно они делают профиль заполненным.
          for (let i = 0; i < students; i += 1) {
            await tx.schoolStudent.create({
              data: { workspaceId: ws, classId: cls.id, seq: i + 1, sex: i < boys ? 'm' : 'f' },
            });
          }
          await this.outbox.enqueue(
            tx,
            newEvent<ClassCreatedV1>({
              type: SCHOOL_EVENTS.classCreated,
              workspaceId: ws,
              actor: actor.userId,
              payload: { classId: cls.id, parallel: p, letter, groupCount: dto.groups ?? 0 },
            }),
          );
        }
      }
      await this.state.bump(tx, 'contingent', { id: actor.userId, name: actor.name }, ws);
    });
    return { ok: true, created: dto.parallels * letters.length };
  }

  // ─────────────── профиль ученика (§11 строки 9, 10) ───────────────

  /** `S-12.btn.addStudent`: ученик, добавленный после разбиения, идёт в меньшую группу. */
  async addStudent(classId: string, dto: UpsertStudentDto, actor: SchoolActor) {
    const ws = TenantContext.require();
    const cls = await this.prisma.schoolClass.findUnique({ where: { id: classId } });
    if (!cls) throw new NotFoundException('класс не найден');
    const seq = (await this.prisma.schoolStudent.count({ where: { classId } })) + 1;
    const created = await this.prisma.schoolStudent.create({
      data: {
        workspaceId: ws,
        classId,
        seq,
        lastName: dto.lastName.trim(),
        firstName: dto.firstName.trim(),
        middleName: dto.middleName?.trim() || null,
        sex: dto.sex,
      },
    });
    await this.assignGroup(created.id, classId, dto.groupNo ?? null);
    await this.emitUpserted(created.id, actor);
    return this.getStudent(created.id);
  }

  /** `S-13.btn.save`: сохранение пересортировывает список (сортировка — в чтении). */
  async updateStudent(id: string, dto: UpsertStudentDto, actor: SchoolActor) {
    const s = await this.prisma.schoolStudent.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('ученик не найден');
    await this.prisma.schoolStudent.update({
      where: { id },
      data: {
        lastName: dto.lastName.trim(),
        firstName: dto.firstName.trim(),
        middleName: dto.middleName?.trim() || null,
        sex: dto.sex,
      },
    });
    await this.assignGroup(id, s.classId, dto.groupNo ?? null);
    await this.emitUpserted(id, actor);
    return this.getStudent(id);
  }

  /**
   * Дефолт-разбиение по алфавиту поровну (AR-75) применяется, когда класс
   * заполнен целиком; ученик, добавленный позже, попадает в группу с наименьшей
   * численностью (при равенстве — с меньшим номером), а разбиение остальных **не
   * пересчитывается**: пересортировка групп сменила бы человеку класс на бумаге,
   * ничего не спросив.
   */
  private async assignGroup(studentId: string, classId: string, groupNo: number | null): Promise<void> {
    const groups = await this.prisma.studentGroup.findMany({ where: { classId }, orderBy: { groupNo: 'asc' } });
    if (!groups.length) return;

    if (groupNo) {
      const g = groups.find((x) => x.groupNo === groupNo);
      if (g) {
        await this.prisma.schoolStudent.update({ where: { id: studentId }, data: { groupId: g.id } });
        return;
      }
    }
    const students = await this.prisma.schoolStudent.findMany({ where: { classId } });
    const unassigned = students.filter((s) => s.groupId === null);
    const allFilled = students.every(isFilled);

    if (allFilled && unassigned.length === students.length) {
      // класс заполнен целиком и ни один ученик не разведён — дефолт-разбиение
      const sorted = [...students].sort(byName);
      for (let i = 0; i < sorted.length; i += 1) {
        const idx = Math.floor((i * groups.length) / sorted.length);
        await this.prisma.schoolStudent.update({ where: { id: sorted[i].id }, data: { groupId: groups[idx].id } });
      }
      return;
    }
    // добор: наименьшая группа, при равенстве — меньший номер
    const counts = groups.map((g) => ({ g, n: students.filter((s) => s.groupId === g.id).length }));
    counts.sort((a, b) => a.n - b.n || a.g.groupNo - b.g.groupNo);
    await this.prisma.schoolStudent.update({ where: { id: studentId }, data: { groupId: counts[0].g.id } });
  }

  private async emitUpserted(studentId: string, actor: SchoolActor): Promise<void> {
    const ws = TenantContext.require();
    const s = await this.prisma.schoolStudent.findUnique({ where: { id: studentId }, include: { group: true } });
    if (!s) return;
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(
        tx,
        newEvent<StudentUpsertedV1>({
          type: SCHOOL_EVENTS.studentUpserted,
          workspaceId: ws,
          actor: actor.userId,
          payload: {
            studentId: s.id,
            classId: s.classId,
            groupNo: s.group?.groupNo ?? null,
            lastName: s.lastName,
            firstName: s.firstName,
            middleName: s.middleName,
            sex: (s.sex as 'm' | 'f' | null) ?? null,
          },
        }),
      ),
    );
  }

  // ─────────────── удаление, деактивация, реактивация (§11 строки 11, 12, 27) ───────────────

  /**
   * Удаление доступно ТОЛЬКО записи без отметок (AR-78); запись с историей
   * деактивируется. Обратной операции у удаления нет — цена ошибки равна
   * повторному вводу ФИО, и это записанная причина, а не умолчание (AR-90).
   */
  async deleteStudent(id: string, actor: SchoolActor) {
    const s = await this.prisma.schoolStudent.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('ученик не найден');
    // Гейт живёт в контракте, а не в интерфейсе (красная линия 3): подмена кнопки
    // на экране не заменяет проверки на сервере. Между открытием карточки
    // (`hasMarks: false`) и нажатием педагог мог поставить отметку — это штатная
    // конкурентность (AR-109), и у отказа есть своё имя (AR-113).
    if (await this.journal.studentHasMarks(id)) throw new SchoolError('STUDENT_HAS_MARKS');
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolStudent.delete({ where: { id } });
      await this.outbox.enqueue(
        tx,
        newEvent<StudentDeletedV1>({
          type: SCHOOL_EVENTS.studentDeleted,
          workspaceId: ws,
          actor: actor.userId,
          payload: { studentId: id, classId: s.classId },
        }),
      );
    });
    return { ok: true };
  }

  async deactivateStudent(id: string, actor: SchoolActor) {
    const s = await this.prisma.schoolStudent.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('ученик не найден');
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolStudent.update({ where: { id }, data: { deactivatedAt: new Date() } });
      await this.outbox.enqueue(
        tx,
        newEvent<StudentDeactivatedV1>({
          type: SCHOOL_EVENTS.studentDeactivated,
          workspaceId: ws,
          actor: actor.userId,
          payload: { studentId: id, classId: s.classId, reason: 'moderator' },
        }),
      );
    });
    return { ok: true };
  }

  async reactivateStudent(id: string, actor: SchoolActor) {
    const s = await this.prisma.schoolStudent.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('ученик не найден');
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolStudent.update({ where: { id }, data: { deactivatedAt: null } });
      await this.outbox.enqueue(
        tx,
        newEvent<StudentReactivatedV1>({
          type: SCHOOL_EVENTS.studentReactivated,
          workspaceId: ws,
          actor: actor.userId,
          payload: { studentId: id, classId: s.classId },
        }),
      );
    });
    return { ok: true };
  }

  /**
   * §11 строка 26 · `S-12.btn.deleteClass`. Самая дорогая необратимость версии:
   * вместе с классом удаляются профили его учеников — **заполненные тоже**
   * (AR-105). Условие — «ни у одного ученика нет отметок»; иначе
   * `CLASS_HAS_MARKS`.
   */
  async deleteClass(id: string, actor: SchoolActor) {
    const cls = await this.prisma.schoolClass.findUnique({ where: { id }, include: { students: true } });
    if (!cls) throw new NotFoundException('класс не найден');
    if (await this.journal.classHasMarks(id)) throw new SchoolError('CLASS_HAS_MARKS');

    const ws = TenantContext.require();
    const studentIds = cls.students.map((s) => s.id);
    await this.prisma.$transaction(async (tx) => {
      for (const sid of studentIds) {
        await this.outbox.enqueue(
          tx,
          newEvent<StudentDeletedV1>({
            type: SCHOOL_EVENTS.studentDeleted,
            workspaceId: ws,
            actor: actor.userId,
            payload: { studentId: sid, classId: id },
          }),
        );
      }
      await tx.schoolClass.delete({ where: { id } });
      await this.outbox.enqueue(
        tx,
        newEvent<ClassDeletedV1>({
          type: SCHOOL_EVENTS.classDeleted,
          workspaceId: ws,
          actor: actor.userId,
          payload: { classId: id, studentsDeleted: studentIds.length },
        }),
      );
      await this.state.bump(tx, 'contingent', { id: actor.userId, name: actor.name }, ws);
    });
    return { ok: true, studentsDeleted: studentIds.length };
  }
}

/**
 * Публичный ЧИТАЮЩИЙ контракт контингента (AR-45, AR-52). Расписание и предметы
 * спрашивают состав школы здесь — SQL-джойном в чужую схему они не ходят, и
 * ровно этот же контракт получит сторонний сервис EduStore.
 */
@Injectable()
export class ContingentContractService {
  constructor(private readonly prisma: PrismaService) {}

  classes(): Promise<{ id: string; parallel: number; label: string; groupCount: number }[]> {
    return this.prisma.schoolClass.findMany({
      select: { id: true, parallel: true, label: true, groupCount: true },
      orderBy: [{ parallel: 'asc' }, { letter: 'asc' }],
    });
  }

  /** Группы, у которых состав не назначен, — отказ `GROUPS_UNASSIGNED` до перебора. */
  async classesWithUnassignedGroups(): Promise<{ id: string; label: string }[]> {
    const classes = await this.prisma.schoolClass.findMany({ include: { students: true, groups: true } });
    return classes
      .filter((c) => c.groupCount > 0 && c.students.some((s) => s.groupId === null && s.deactivatedAt === null))
      .map((c) => ({ id: c.id, label: c.label }));
  }

  activeStudents(classId: string) {
    return this.prisma.schoolStudent.findMany({
      where: { classId, deactivatedAt: null },
      include: { group: true },
    });
  }
}

export type ContingentTx = Prisma.TransactionClient;
