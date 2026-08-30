import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { TenantContext } from '../../common/tenant/tenant-context';
import { type DomainEvent } from '../../common/events/domain-event';
import { TEXTBOOK_EVENTS, type TextbookParsedV1 } from '../textbook/textbook.contract';
import { ENGINE_EVENTS, type KppApprovedV1, type KtpApprovedV1 } from './engine.contract';
import { EngineService } from './engine.service';

/**
 * Пайплайн §7: textbook.parsed → черновик КТП (генератор) → завуч утверждает → ktp.approved →
 * Solver раскладывает КПП → kpp.scheduled → завуч утверждает → kpp.approved → карты в уроки.
 * Идемпотентность — внутри сервисных методов (повтор события не плодит дубли),
 * поэтому inbox-дедуп не нужен (и не оборачиваем в чужую транзакцию).
 */
@Injectable()
export class EngineHandlers implements OnModuleInit {
  private readonly log = new Logger('engine');

  constructor(
    private readonly bus: EventBus,
    private readonly engine: EngineService,
  ) {}

  onModuleInit() {
    this.bus.subscribe(TEXTBOOK_EVENTS.parsed, 'engine-ktp-gen', (e) => this.onTextbookParsed(e));
    this.bus.subscribe(ENGINE_EVENTS.ktpApproved, 'engine-solver', (e) => this.onKtpApproved(e));
    this.bus.subscribe(ENGINE_EVENTS.kppApproved, 'engine-lesson-content', (e) => this.onKppApproved(e));
  }

  /** textbook.parsed → черновик КТП с темами (оценка часов по картам, hoursSource=estimated). */
  private async onTextbookParsed(e: DomainEvent) {
    const p = e.payload as TextbookParsedV1;
    await TenantContext.run({ tenantId: e.workspaceId, system: false }, async () => {
      const res = await this.engine.generateKtpFromParsed(p);
      if (res) this.log.log(`КТП ${res.ktpId}: черновик создан/дополнен по textbook.parsed (material=${p.materialId})`);
    });
  }

  private async onKtpApproved(e: DomainEvent) {
    const p = e.payload as KtpApprovedV1;
    // тенант-контекст события (работает и в inline-, и в фоновом дренаже)
    await TenantContext.run({ tenantId: e.workspaceId, system: false }, async () => {
      const kpp = await this.engine.generateKpp(p.classId, p.disciplineId);
      this.log.log(`КПП ${kpp.id} сгенерирован по ktp.approved (${kpp.lessonCount} уроков)`);
    });
  }

  /** kpp.approved → карты тем равномерно раскладываются по урокам (LessonContent). */
  private async onKppApproved(e: DomainEvent) {
    const p = e.payload as KppApprovedV1;
    await TenantContext.run({ tenantId: e.workspaceId, system: false }, () => this.engine.fillLessonContents(p.kppId));
  }
}
