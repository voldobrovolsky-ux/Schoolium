import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { TenantContext } from '../../common/tenant/tenant-context';
import { type DomainEvent } from '../../common/events/domain-event';
import {
  ENGINE_EVENTS,
  type AssessmentCheckedV1,
  type AttendanceMarkedV1,
  type TopicCompletedV1,
} from './engine.contract';
import { IomService } from './iom.service';

/**
 * ИОМ подписан на сигналы (Движок §4). Идемпотентность — внутри аккумулятора (ключи signalRefs),
 * поэтому inbox-дедуп не нужен. topic.progressed — нетерминальный (прогресс-движение, не mastery)
 * → ИОМ его для score не использует (подписка только на terminal topic.completed + attendance).
 */
@Injectable()
export class IomHandlers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly iom: IomService,
  ) {}

  onModuleInit() {
    this.bus.subscribe(ENGINE_EVENTS.attendanceMarked, 'iom', (e) => this.onAttendance(e));
    this.bus.subscribe(ENGINE_EVENTS.topicCompleted, 'iom', (e) => this.onTopic(e));
    this.bus.subscribe(ENGINE_EVENTS.assessmentChecked, 'iom', (e) => this.onAssessment(e));
  }

  private run<T>(e: DomainEvent, fn: () => Promise<T>) {
    return TenantContext.run({ tenantId: e.workspaceId, system: false }, fn);
  }

  private onAttendance(e: DomainEvent) {
    const p = e.payload as AttendanceMarkedV1;
    return this.run(e, () => this.iom.onAttendance(p.lessonId, p.marks));
  }

  private onTopic(e: DomainEvent) {
    const p = e.payload as TopicCompletedV1;
    return this.run(e, () => this.iom.onTopicCompleted(p.lessonId, p.topicId));
  }

  private onAssessment(e: DomainEvent) {
    const p = e.payload as AssessmentCheckedV1;
    return this.run(e, () => this.iom.onAssessmentChecked(p.briefTestId, p.lessonId, p.results));
  }
}
