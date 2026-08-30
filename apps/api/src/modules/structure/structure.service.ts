import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import { STRUCTURE_EVENTS, type AssignmentEventV1 } from './structure.contract';
import type { AddSubGroupDto, AssignDto, CreateClassDto, CreateSubjectDto } from './dto';
// AR-36: контракты ответов — из @edustore/shared (тот же источник, что у фронта):
// дрейф формы ответа ломает tsc, а не обнаруживается в проде
import type { StClass, StDevice, StSubject, StTeacher } from '@edustore/shared';

/**
 * Ручное создание структуры школы (онбординг шаги 4.2 и 6):
 * классы/подгруппы (админ), дисциплины и распределение учителей (методист/завуч).
 * Тенант — школа (Workspace) из контекста запроса: чтения фильтрует tenant-guard,
 * записи проставляют workspaceId = TenantContext.require(). Ручной org-фильтр не нужен.
 */
@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── классы / подгруппы ───
  async listClasses(): Promise<StClass[]> {
    const classes = await this.prisma.class.findMany({
      orderBy: [{ parallel: 'asc' }, { letter: 'asc' }],
      include: { subGroups: true, _count: { select: { students: true } } },
    });
    return classes.map((c) => ({
      id: c.id, label: c.label, parallel: c.parallel, letter: c.letter,
      students: c._count.students,
      subGroups: c.subGroups.map((g) => ({ id: g.id, name: g.name })),
    }));
  }

  async createClass(dto: CreateClassDto) {
    const letter = dto.letter.trim().toUpperCase();
    const c = await this.prisma.class.create({
      data: { workspaceId: TenantContext.require(), parallel: dto.parallel, letter, label: `${dto.parallel}${letter}` },
    });
    return { id: c.id, label: c.label, parallel: c.parallel, letter: c.letter, students: 0, subGroups: [] };
  }

  async deleteClass(id: string) {
    await this.prisma.class.delete({ where: { id } });
    return { ok: true };
  }

  async addSubGroup(classId: string, dto: AddSubGroupDto) {
    const g = await this.prisma.subGroup.create({
      data: { workspaceId: TenantContext.require(), classId, name: dto.name.trim() },
    });
    return { id: g.id, name: g.name };
  }

  async deleteSubGroup(id: string) {
    await this.prisma.subGroup.delete({ where: { id } });
    return { ok: true };
  }

  // ─── дисциплины ───
  async listSubjects(): Promise<StSubject[]> {
    const s = await this.prisma.subject.findMany({ orderBy: { name: 'asc' } });
    return s.map((x) => ({ id: x.id, name: x.name, color: x.color }));
  }

  async createSubject(dto: CreateSubjectDto) {
    const s = await this.prisma.subject.create({
      data: { workspaceId: TenantContext.require(), name: dto.name.trim(), color: dto.color ?? '#2563EB' },
    });
    return { id: s.id, name: s.name, color: s.color };
  }

  async deleteSubject(id: string) {
    await this.prisma.subject.delete({ where: { id } });
    return { ok: true };
  }

  // ─── учителя + распределение ───
  async listTeachers(): Promise<StTeacher[]> {
    const teachers = await this.prisma.teacher.findMany({
      include: { user: true, assignments: { include: { class: true, subject: true } } },
    });
    return teachers.map((t) => ({
      id: t.id,
      name: t.user.displayName,
      assignments: t.assignments.map((a) => ({
        id: a.id, classId: a.classId, classLabel: a.class.label,
        subjectId: a.subjectId, subjectName: a.subject.name, subGroupId: a.subGroupId,
      })),
    }));
  }

  async assign(dto: AssignDto) {
    const ws = TenantContext.require();
    // AR-30: назначение учителя — админ-действие с касанием identity → событие для аудита
    const a = await this.prisma.$transaction(async (tx) => {
      const row = await tx.teachingAssignment.upsert({
        where: { teacherId_classId_subjectId: { teacherId: dto.teacherId, classId: dto.classId, subjectId: dto.subjectId } },
        update: { subGroupId: dto.subGroupId ?? null },
        create: { workspaceId: ws, teacherId: dto.teacherId, classId: dto.classId, subjectId: dto.subjectId, subGroupId: dto.subGroupId ?? null },
      });
      await this.outbox.enqueue(
        tx,
        newEvent<AssignmentEventV1>({
          type: STRUCTURE_EVENTS.assignmentCreated,
          workspaceId: ws,
          payload: { assignmentId: row.id, teacherId: dto.teacherId, classId: dto.classId, subjectId: dto.subjectId },
        }),
      );
      return row;
    });
    return { id: a.id };
  }

  async unassign(id: string) {
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.teachingAssignment.delete({ where: { id } });
      await this.outbox.enqueue(
        tx,
        newEvent<AssignmentEventV1>({
          type: STRUCTURE_EVENTS.assignmentRemoved,
          workspaceId: ws,
          payload: { assignmentId: id, teacherId: row.teacherId },
        }),
      );
    });
    return { ok: true };
  }

  // ─── привязанные устройства-киоски (реальные, из таблицы Device) ───
  async listDevices(): Promise<StDevice[]> {
    const devices = await this.prisma.device.findMany({ orderBy: { createdAt: 'desc' } });
    const boundIds = [...new Set(devices.map((d) => d.boundByUserId).filter((x): x is string => !!x))];
    const users = boundIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: boundIds } } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));
    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      boundBy: d.boundByUserId ? (nameById.get(d.boundByUserId) ?? null) : null,
      boundAt: d.createdAt.toISOString(),
    }));
  }

  async deleteDevice(id: string) {
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      await tx.device.delete({ where: { id } });
      await this.outbox.enqueue(
        tx,
        newEvent({ type: STRUCTURE_EVENTS.deviceRemoved, workspaceId: ws, payload: { deviceId: id } }),
      );
    });
    return { ok: true };
  }
}
