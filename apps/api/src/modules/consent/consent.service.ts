import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsentPurpose, ConsentSource } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import {
  COMPLIANCE_EVENTS,
  type ConsentRecordedV1,
  type DeletionRequestedV1,
} from '../../parameters/compliance/contract';

export interface RecordConsentInput {
  subjectUserId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  version?: string;
  grantedAt?: Date; // для минора — дата бумажного носителя
  evidenceRef?: string;
}

/**
 * Согласие на обработку ПДн (§6). Append-only: каждый grant/revoke — новая запись.
 * Consent-as-onboarding: фиксируется записью (purpose/version/date/source), не препятствие.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async record(input: RecordConsentInput) {
    // §6.2: минор — школьный админ грузит бумажное согласие, обязателен скан (evidence) + дата
    if (input.source === ConsentSource.school_admin && !input.evidenceRef) {
      throw new BadRequestException('согласие минора (school_admin) требует evidenceRef — скан бумажного');
    }
    const workspaceId = TenantContext.require();
    // запись согласия + событие (для audit-леджера §4.8) — атомарно
    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.consent.create({
        data: {
          workspaceId,
          subjectUserId: input.subjectUserId,
          purpose: input.purpose,
          granted: input.granted,
          grantedAt: input.grantedAt ?? new Date(),
          version: input.version ?? '1.0',
          source: input.source,
          evidenceRef: input.evidenceRef ?? null,
        },
      });
      await this.outbox.enqueue(
        tx,
        newEvent<ConsentRecordedV1>({
          type: COMPLIANCE_EVENTS.consentRecorded,
          workspaceId,
          payload: {
            subjectUserId: input.subjectUserId,
            purpose: input.purpose,
            granted: input.granted,
            source: input.source,
          },
        }),
      );
      return consent;
    });
  }

  list(subjectUserId: string) {
    return this.prisma.consent.findMany({ where: { subjectUserId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * §6.3: актуальное согласие на цель = последняя запись `granted`. Гейт перед любым
   * profiling/risk-score: `has(subject, 'predictive_profiling')` (отдельная цель, не общая галочка).
   */
  async has(subjectUserId: string, purpose: ConsentPurpose): Promise<boolean> {
    const latest = await this.prisma.consent.findFirst({
      where: { subjectUserId, purpose },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.granted ?? false;
  }

  /**
   * Батч-версия гейта §6.3 для классовых срезов (AR-29): множество субъектов с
   * действующим согласием на цель (последняя запись каждого субъекта = granted).
   */
  async grantedSet(subjectUserIds: string[], purpose: ConsentPurpose): Promise<Set<string>> {
    if (subjectUserIds.length === 0) return new Set();
    const rows = await this.prisma.consent.findMany({
      where: { subjectUserId: { in: subjectUserIds }, purpose },
      orderBy: { createdAt: 'desc' },
      select: { subjectUserId: true, granted: true },
    });
    const latest = new Map<string, boolean>();
    for (const r of rows) if (!latest.has(r.subjectUserId)) latest.set(r.subjectUserId, r.granted);
    return new Set([...latest.entries()].filter(([, g]) => g).map(([id]) => id));
  }

  /**
   * §6.4: запрос на удаление → событие (джоб 30 дней; обязательная отчётность обезличивается,
   * не удаляется). Эмит в outbox транзакционно → каскад/audit (§4.8) подхватит.
   */
  async requestDeletion(subjectUserId: string, requestedBy: string, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(
        tx,
        newEvent<DeletionRequestedV1>({
          type: COMPLIANCE_EVENTS.deletionRequested,
          workspaceId: TenantContext.require(),
          actor: requestedBy,
          payload: { subjectUserId, requestedBy, reason },
        }),
      );
    });
    return { ok: true, subjectUserId, scheduledDays: 30 };
  }
}
