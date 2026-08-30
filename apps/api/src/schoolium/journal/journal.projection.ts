import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { EventBus } from '../../common/events/event-bus';
import type { DomainEvent } from '../../common/events/domain-event';
import {
  SCHOOL_EVENTS,
  type ClassDeletedV1,
  type LessonDetachedV1,
  type LessonMaterializedV1,
  type StudentDeactivatedV1,
  type StudentDeletedV1,
  type StudentReactivatedV1,
  type StudentUpsertedV1,
} from '../schoolium.contract';

/**
 * Журнал ПРОИЗВОДЕН (AR-74) и строится **подписками**, а не чтением чужих таблиц
 * (AR-45, красная линия 5):
 *   колонки — `schedule.lesson.materialized.v1` и `schedule.lesson.detached.v1`;
 *   строки  — события контингента, включая `contingent.student.deleted.v1`.
 *
 * Без парного события об отвязке журнал показывал бы колонки уроков, которых уже
 * нет; без события об удалении ученика строка удалённого висела бы вечно
 * (AR-108). Поэтому обе проекции ведутся здесь, а не сверкой таблиц.
 *
 * Дедуп доставки — централизованно в шине (AR-24): повторная доставка события
 * этому потребителю пропускается, и проекция не двоится.
 */
@Injectable()
export class JournalProjection implements OnModuleInit {
  private readonly log = new Logger('JournalProjection');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    const on = (type: string, h: (e: DomainEvent) => Promise<void>) => this.bus.subscribe(type, 'journal', h);
    on(SCHOOL_EVENTS.lessonMaterialized, (e) => this.onMaterialized(e));
    on(SCHOOL_EVENTS.lessonDetached, (e) => this.onDetached(e));
    on(SCHOOL_EVENTS.studentUpserted, (e) => this.onStudent(e));
    on(SCHOOL_EVENTS.studentDeactivated, (e) => this.onDeactivated(e));
    on(SCHOOL_EVENTS.studentReactivated, (e) => this.onReactivated(e));
    on(SCHOOL_EVENTS.studentDeleted, (e) => this.onStudentDeleted(e));
    on(SCHOOL_EVENTS.classDeleted, (e) => this.onClassDeleted(e));
  }

  /** Появляется колонка на дату урока; два урока в дату — две колонки. */
  private async onMaterialized(e: DomainEvent): Promise<void> {
    const p = e.payload as LessonMaterializedV1;
    await TenantContext.runAsSystem(() =>
      this.prisma.journalColumn.upsert({
        where: { lessonId: p.lessonId },
        update: { teacherId: p.teacherId, detachedAt: null },
        create: {
          workspaceId: e.workspaceId,
          lessonId: p.lessonId,
          date: new Date(p.date),
          slotNo: p.slotNo,
          classId: p.classId,
          groupNo: p.groupNo ?? 0,
          subjectId: p.subjectId,
          teacherId: p.teacherId,
        },
      }),
    );
  }

  /** Колонка помечается «вне расписания»: отметки читаются, запись отклоняется. */
  private async onDetached(e: DomainEvent): Promise<void> {
    const p = e.payload as LessonDetachedV1;
    await TenantContext.runAsSystem(() =>
      this.prisma.journalColumn.updateMany({
        where: { lessonId: p.lessonId },
        data: { detachedAt: new Date(e.occurredAt) },
      }),
    );
  }

  private async onStudent(e: DomainEvent): Promise<void> {
    const p = e.payload as StudentUpsertedV1;
    await TenantContext.runAsSystem(() =>
      this.prisma.journalRow.upsert({
        where: { studentId: p.studentId },
        update: {
          classId: p.classId,
          lastName: p.lastName,
          firstName: p.firstName,
          middleName: p.middleName,
          sex: p.sex,
          groupNo: p.groupNo,
        },
        create: {
          workspaceId: e.workspaceId,
          studentId: p.studentId,
          classId: p.classId,
          lastName: p.lastName,
          firstName: p.firstName,
          middleName: p.middleName,
          sex: p.sex,
          groupNo: p.groupNo,
        },
      }),
    );
  }

  private async onDeactivated(e: DomainEvent): Promise<void> {
    const p = e.payload as StudentDeactivatedV1;
    await TenantContext.runAsSystem(() =>
      this.prisma.journalRow.updateMany({ where: { studentId: p.studentId }, data: { deactivated: true } }),
    );
  }

  private async onReactivated(e: DomainEvent): Promise<void> {
    const p = e.payload as StudentReactivatedV1;
    await TenantContext.runAsSystem(() =>
      this.prisma.journalRow.updateMany({ where: { studentId: p.studentId }, data: { deactivated: false } }),
    );
  }

  /** Строка снимается вместе с отметками — иначе она остаётся строкой-призраком. */
  private async onStudentDeleted(e: DomainEvent): Promise<void> {
    const p = e.payload as StudentDeletedV1;
    await TenantContext.runAsSystem(() =>
      this.prisma.journalRow.deleteMany({ where: { studentId: p.studentId } }),
    );
  }

  private async onClassDeleted(e: DomainEvent): Promise<void> {
    const p = e.payload as ClassDeletedV1;
    await TenantContext.runAsSystem(async () => {
      await this.prisma.journalRow.deleteMany({ where: { classId: p.classId, workspaceId: e.workspaceId } });
      await this.prisma.journalColumn.deleteMany({ where: { classId: p.classId, workspaceId: e.workspaceId } });
    });
    this.log.log(`класс ${p.classId} удалён: строки и колонки журнала сняты`);
  }
}
