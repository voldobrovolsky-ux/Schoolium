import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { TenantContext } from '../../common/tenant/tenant-context';
import { type DomainEvent } from '../../common/events/domain-event';
import { DOC_EVENTS, type FileEnrichedV1 } from '../doc/doc.contract';
import { ParserService } from './parser.service';

/**
 * Парсер подписан на doc.file.enriched (Документохранилище_ТЗ §5): OCR один раз в хранилище,
 * парсер переиспользует textExtract, повторного Vision не гоняет. Не про учебник (нет Material) —
 * тихо игнорируется внутри сервиса. Идемпотентность — там же (повторный разбор = no-op).
 */
@Injectable()
export class ParserHandlers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly parser: ParserService,
  ) {}

  onModuleInit() {
    this.bus.subscribe(DOC_EVENTS.fileEnriched, 'textbook-parser', (e) => this.onEnriched(e));
  }

  private onEnriched(e: DomainEvent) {
    const p = e.payload as FileEnrichedV1;
    return TenantContext.run({ tenantId: e.workspaceId, system: false }, () =>
      this.parser.parseFromEnriched(p.fileId, p.textExtract),
    );
  }
}
