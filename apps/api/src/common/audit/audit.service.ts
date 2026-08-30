import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../events/event-bus';
import { Inbox } from '../outbox/inbox.service';
import { type DomainEvent } from '../events/domain-event';
import { COMPLIANCE_EVENTS } from '../../parameters/compliance/contract';
import { CONTINGENT_EVENTS } from '../../parameters/contingent/contract';
import { ENGINE_EVENTS } from '../../modules/engine/engine.contract';
import { DOC_EVENTS } from '../../modules/doc/doc.contract';
import { STRUCTURE_EVENTS } from '../../modules/structure/structure.contract';
import { SCHOOL_EVENTS } from '../../schoolium/schoolium.contract';

// Реестр событий с касанием ПДн → категории + извлечение субъекта (§4.8).
// Расширение покрытия аудита = строка здесь. Охват AR-30: оценки, утверждения КТП/КПП,
// доступ/шаринг/статус файлов, админ-действия (назначения/устройства), consent/deletion.
// Сообщения Communitoria НЕ дублируются — контур persist-all аудируем по построению.
const AUDITED: Record<string, { categories: string[]; subject: (p: Record<string, unknown>) => string | undefined }> = {
  [CONTINGENT_EVENTS.studentEnrolled]: { categories: ['identity'], subject: (p) => p.studentId as string },
  [COMPLIANCE_EVENTS.consentRecorded]: { categories: ['consent'], subject: (p) => p.subjectUserId as string },
  [COMPLIANCE_EVENTS.deletionRequested]: { categories: ['identity', 'all'], subject: (p) => p.subjectUserId as string },
  // журнал (AR-4/AR-30): кто, кому, когда выставил/снял оценку
  [ENGINE_EVENTS.gradePosted]: { categories: ['learning'], subject: (p) => p.studentId as string },
  [ENGINE_EVENTS.gradeRemoved]: { categories: ['learning'], subject: (p) => p.studentId as string },
  // утверждения планов (кто утвердил — actor конверта)
  [ENGINE_EVENTS.ktpApproved]: { categories: ['process'], subject: () => undefined },
  [ENGINE_EVENTS.kppApproved]: { categories: ['process'], subject: () => undefined },
  // документохранилище: раздача доступа/шаринг/смена статуса
  [DOC_EVENTS.fileShared]: { categories: ['files'], subject: (p) => p.granteeId as string | undefined },
  [DOC_EVENTS.fileAccessChanged]: { categories: ['files'], subject: () => undefined },
  [DOC_EVENTS.fileStatusChanged]: { categories: ['files'], subject: () => undefined },
  // админ-действия структуры: назначения учителей, отвязка устройств
  [STRUCTURE_EVENTS.assignmentCreated]: { categories: ['identity'], subject: (p) => p.teacherId as string },
  [STRUCTURE_EVENTS.assignmentRemoved]: { categories: ['identity'], subject: (p) => p.teacherId as string },
  [STRUCTURE_EVENTS.deviceRemoved]: { categories: ['devices'], subject: () => undefined },
  // ─── Schoolium 1.1.1: аудит как ПРОТИВОВЕС полным правам модератора ───
  // AR-88 назвал цену полномочий: модератор — единственная точка, из которой
  // достижим любой аккаунт школы. Сдерживающий механизм один — полный аудит его
  // действий, поэтому аудит перестаёт быть фоновой функцией и получает
  // собственные ворота (G-41). Здесь перечислены ВСЕ 22 события версии: каждое
  // ложится в леджер с идентичностью действующего из конверта (AR-21, AR-30).
  [SCHOOL_EVENTS.classCreated]: { categories: ['identity'], subject: () => undefined },
  [SCHOOL_EVENTS.classDeleted]: { categories: ['identity'], subject: () => undefined },
  [SCHOOL_EVENTS.studentUpserted]: { categories: ['identity'], subject: (p) => p.studentId as string },
  [SCHOOL_EVENTS.studentDeactivated]: { categories: ['identity'], subject: (p) => p.studentId as string },
  [SCHOOL_EVENTS.studentReactivated]: { categories: ['identity'], subject: (p) => p.studentId as string },
  [SCHOOL_EVENTS.studentDeleted]: { categories: ['identity'], subject: (p) => p.studentId as string },
  [SCHOOL_EVENTS.subjectDeleted]: { categories: ['process'], subject: () => undefined },
  [SCHOOL_EVENTS.teacherBound]: { categories: ['identity'], subject: (p) => p.teacherId as string },
  [SCHOOL_EVENTS.teacherUnbound]: { categories: ['identity'], subject: (p) => p.teacherId as string },
  [SCHOOL_EVENTS.staffRegistered]: { categories: ['identity'], subject: (p) => p.userId as string },
  [SCHOOL_EVENTS.staffDeactivated]: { categories: ['identity'], subject: (p) => p.userId as string },
  [SCHOOL_EVENTS.staffReactivated]: { categories: ['identity'], subject: (p) => p.userId as string },
  [SCHOOL_EVENTS.staffDeleted]: { categories: ['identity'], subject: (p) => p.userId as string },
  [SCHOOL_EVENTS.sessionStarted]: { categories: ['identity'], subject: (p) => p.userId as string },
  [SCHOOL_EVENTS.sessionRevoked]: { categories: ['identity'], subject: (p) => p.userId as string },
  [SCHOOL_EVENTS.termSet]: { categories: ['process'], subject: () => undefined },
  [SCHOOL_EVENTS.templateConfirmed]: { categories: ['process'], subject: () => undefined },
  [SCHOOL_EVENTS.lessonMaterialized]: { categories: ['process'], subject: () => undefined },
  [SCHOOL_EVENTS.lessonDetached]: { categories: ['process'], subject: () => undefined },
  [SCHOOL_EVENTS.markPosted]: { categories: ['learning'], subject: (p) => p.studentId as string },
  [SCHOOL_EVENTS.markRemoved]: { categories: ['learning'], subject: (p) => p.studentId as string },
  [SCHOOL_EVENTS.topicSet]: { categories: ['process'], subject: () => undefined },
};

/** Перечисление для ворот G-41: какие типы событий попадают в аудит. */
export const AUDITED_TYPES = Object.keys(AUDITED);

/**
 * Audit-леджер (§4.8): append-only иммутабельный журнал ПДн-действий. Пишется ИЗ СОБЫТИЙ —
 * подписывается на типы с касанием ПДн и кладёт запись (идемпотентно через inbox).
 * В отличие от OutboxEvent, не чистится и не правится — это и есть «протокол».
 */
@Injectable()
export class AuditService implements OnModuleInit {
  private readonly log = new Logger('Audit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly inbox: Inbox,
  ) {}

  onModuleInit() {
    for (const type of Object.keys(AUDITED)) {
      this.bus.subscribe(type, 'audit', (e) => this.onEvent(e));
    }
  }

  private async onEvent(e: DomainEvent) {
    const spec = AUDITED[e.type];
    if (!spec) return;
    await this.inbox.handle(e.id, 'audit', async (tx) => {
      await tx.auditLog.create({
        data: {
          eventId: e.id,
          workspaceId: e.workspaceId, // из конверта (system-контекст воркера)
          actor: e.actor ?? null,
          subjectUserId: spec.subject(e.payload as Record<string, unknown>) ?? null,
          action: e.type,
          occurredAt: new Date(e.occurredAt),
          persDataCategories: spec.categories,
        },
      });
    });
  }

  /** Чтение журнала (admin), тенант-scoped через guard. */
  list(limit = 100) {
    return this.prisma.auditLog.findMany({ orderBy: { occurredAt: 'desc' }, take: limit });
  }

  /**
   * ЧИТАЮЩИЙ КОНТРАКТ аудита для `S-60` (AR-45): «журнал собственных действий».
   * Кабинет модератора спрашивает у аудита, а не ходит в его таблицу — красная
   * линия 5 одинакова для доменных контуров и для платформенных.
   */
  listByActor(actor: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      where: { actor },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }
}
