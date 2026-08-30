import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { TenantContext } from '../../common/tenant/tenant-context';
import { type DomainEvent } from '../../common/events/domain-event';
import { DOC_EVENTS, type FileCreatedV1 } from './doc.contract';
import { DocService } from './doc.service';

/**
 * Обогащение raw→enriched по doc.file.created. OCR один раз, в хранилище (Документохранилище_ТЗ §5);
 * педагог-парсер переиспользует textExtract из doc.file.enriched. Реальный Vision/DeepSeek — внешний
 * (стаб транзиции). При недоступности ИИ файл остаётся raw — доступен и ищется по имени/scope (§9).
 */
@Injectable()
export class DocEnrichHandlers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly doc: DocService,
  ) {}

  onModuleInit() {
    this.bus.subscribe(DOC_EVENTS.fileCreated, 'doc-enrich', (e) => this.onCreated(e));
  }

  private onCreated(e: DomainEvent) {
    const p = e.payload as FileCreatedV1;
    return TenantContext.run({ tenantId: e.workspaceId, system: false }, () => this.doc.enrich(p.fileId));
  }
}
