import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { Inbox } from '../../common/outbox/inbox.service';
import { type DomainEvent } from '../../common/events/domain-event';
import { COMPLIANCE_EVENTS, type DeletionRequestedV1 } from './contract';

/**
 * Комплаенс 152-ФЗ (§6.4): реакция на запрос удаления ПДн.
 *
 * СТАБ Фазы 0: полный джоб ставит удаление на 30 дней и ОБЕЗЛИЧИВАЕТ обязательную
 * отчётность (не удаляет), затем эмитит compliance.deletion.completed.v1. Здесь —
 * идемпотентная фиксация запроса + лог; постановка отложенного джоба и обезличивание
 * по доменным таблицам ПДн — следующий шаг (требует реестра ПДн-полей).
 */
@Injectable()
export class ComplianceHandlers implements OnModuleInit {
  private readonly log = new Logger('param:compliance');

  constructor(
    private readonly bus: EventBus,
    private readonly inbox: Inbox,
  ) {}

  onModuleInit() {
    this.bus.subscribe(COMPLIANCE_EVENTS.deletionRequested, 'compliance', (e) => this.onDeletionRequested(e));
  }

  private async onDeletionRequested(e: DomainEvent) {
    const p = e.payload as DeletionRequestedV1;
    await this.inbox.handle(e.id, 'compliance', async () => {
      this.log.warn(
        `удаление ПДн subject=${p.subjectUserId} (инициатор ${p.requestedBy}): запланировано на 30 дней; ` +
          `обязательная отчётность будет обезличена, не удалена [джоб — стаб Фазы 0]`,
      );
    });
  }
}
