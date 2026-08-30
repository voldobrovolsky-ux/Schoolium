import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import { TEXTBOOK_EVENTS, type ParsedCard, type ParsedTopic, type TextbookParsedV1 } from './textbook.contract';
import type { ParserContext, ParserProviderResult } from './parser-provider';
import { RegexpParserProvider } from './regexp-parser.provider';
import { LlmParserProvider } from './llm-parser.provider';
import { ParserSettingsService } from './parser-settings.service';

/**
 * Парсер учебников. Подписан на doc.file.enriched (см. parser.handlers) — по приходу резолвит
 * Material по fileId, переиспользует textExtract и разбирает его на темы/карты выбранным
 * ParserProvider (настройка воркспейса: regexp — стаб по «Глава/§», дефолт; llm — внешний
 * эндпоинт из админки). Падение llm (нет ключа/сеть/невалидный JSON) → fallback на regexp
 * с логом, загрузка НЕ роняется. Эмитит textbook.parsed{materialId, fileId, cards, topics}.
 * Идемпотентен (повторный разбор = no-op).
 */
@Injectable()
export class ParserService {
  private readonly log = new Logger('ParserService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly regexp: RegexpParserProvider,
    private readonly llm: LlmParserProvider,
    private readonly settings: ParserSettingsService,
  ) {}

  /** Контекст для провайдера: класс/предмет из Material (LLM видит их, не наши id). */
  private async resolveContext(material: { classId: string | null; disciplineId: string }): Promise<ParserContext> {
    const [cls, subj] = await Promise.all([
      material.classId ? this.prisma.class.findUnique({ where: { id: material.classId }, select: { label: true } }) : null,
      this.prisma.subject.findUnique({ where: { id: material.disciplineId }, select: { name: true } }),
    ]);
    return { className: cls?.label ?? null, subject: subj?.name ?? null };
  }

  /** Разбор выбранным провайдером; llm упал → fallback regexp (факт логируется). */
  private async runProvider(workspaceId: string, text: string, ctx: ParserContext): Promise<ParserProviderResult> {
    const s = await this.settings.getForWorkspace(workspaceId);
    if (s.provider === 'llm') {
      try {
        return await this.llm.withSettings(s).parse(text, ctx);
      } catch (e) {
        this.log.warn(`llm-провайдер упал → fallback на regexp: ${(e as Error).message}`);
      }
    }
    return this.regexp.parse(text, ctx);
  }

  /**
   * Разбор по событию обогащения. Событие не про учебник (нет Material с этим fileId) → тихо
   * игнорируем (не ошибка). Пустой textExtract / файл не обогащён → деградация (не запускаемся,
   * материал остаётся без тем/карт до реального doc.file.enriched). Повторный вызов — no-op.
   */
  async parseFromEnriched(fileId: string, textExtractFromEvent: string | null): Promise<void> {
    const material = await this.prisma.material.findUnique({ where: { fileId } });
    if (!material) return; // не учебник — тихо игнорируем

    const already =
      (await this.prisma.textbookTopic.count({ where: { materialId: material.id } })) +
      (await this.prisma.textbookCard.count({ where: { materialId: material.id } }));
    if (already > 0) return; // уже разобран (идемпотентность на переигровку события)

    // переиспользуем textExtract: из события, иначе из строки File (обогащение хранилища)
    let text = textExtractFromEvent;
    if (!text || !text.trim()) {
      const file = await this.prisma.file.findUnique({ where: { id: fileId }, select: { textExtract: true } });
      text = file?.textExtract ?? null;
    }
    if (!text || !text.trim()) {
      this.log.debug(`fileId=${fileId}: пустой textExtract — парсер не запускается (деградация)`);
      return; // не гадаем по пустому тексту
    }

    const ctx = await this.resolveContext(material);
    const parsed = await this.runProvider(material.workspaceId, text, ctx);
    if (parsed.topics.length === 0 && parsed.cards.length === 0) {
      this.log.debug(`fileId=${fileId}: структура не распознана — тем/карт нет`);
      return;
    }

    // нормализуем порядок тем к 1..n и готовим контракт события (связь карт по topicOrder)
    const topicOrderByTitle = new Map<string, number>();
    const topics: ParsedTopic[] = parsed.topics.map((t, i) => {
      const order = i + 1;
      if (!topicOrderByTitle.has(t.title)) topicOrderByTitle.set(t.title, order);
      return { order, title: t.title };
    });
    const cards: ParsedCard[] = parsed.cards.map((c, i) => ({
      order: i + 1,
      title: c.title,
      topicOrder: c.topicTitle ? topicOrderByTitle.get(c.topicTitle) : undefined,
    }));

    // темы+карты и событие — атомарно (transactional outbox): либо всё, либо ничего
    await this.prisma.$transaction(async (tx) => {
      const topicIdByOrder = new Map<number, string>();
      for (const t of topics) {
        const row = await tx.textbookTopic.create({
          data: { workspaceId: material.workspaceId, materialId: material.id, fileId, order: t.order, title: t.title },
        });
        topicIdByOrder.set(t.order, row.id);
      }
      for (let i = 0; i < parsed.cards.length; i++) {
        const src = parsed.cards[i];
        const c = cards[i];
        await tx.textbookCard.create({
          data: {
            workspaceId: material.workspaceId,
            materialId: material.id,
            fileId,
            topicId: c.topicOrder ? topicIdByOrder.get(c.topicOrder) ?? null : null,
            order: c.order,
            title: c.title,
            content: src.content || null,
          },
        });
      }
      await this.outbox.enqueue(
        tx,
        newEvent<TextbookParsedV1>({
          type: TEXTBOOK_EVENTS.parsed,
          workspaceId: material.workspaceId,
          payload: { materialId: material.id, fileId, cards, topics },
        }),
      );
    });
    this.log.log(`fileId=${fileId}: разобрано тем=${topics.length}, карт=${cards.length} → textbook.parsed`);
  }

  /** Чтение разбора (для UI/e2e): темы+карты материала по fileId. */
  async getParsed(fileId: string) {
    const material = await this.prisma.material.findUnique({ where: { fileId } });
    if (!material) return { materialId: null, fileId, topics: [], cards: [] };
    const [topics, cards] = await Promise.all([
      this.prisma.textbookTopic.findMany({ where: { materialId: material.id }, orderBy: { order: 'asc' } }),
      this.prisma.textbookCard.findMany({ where: { materialId: material.id }, orderBy: { order: 'asc' } }),
    ]);
    return { materialId: material.id, fileId, topics, cards };
  }

  /**
   * «Проверить соединение» (админка): короткий тестовый текст в НАСТРОЕННЫЙ llm-эндпоинт.
   * Возвращает исход, не бросает (результат показывается админу как есть).
   */
  async testLlmConnection(): Promise<{ ok: boolean; topics?: number; cards?: number; error?: string }> {
    const ws = TenantContext.require();
    const s = await this.settings.getForWorkspace(ws);
    const sample = 'Глава 1. Проверка соединения\n§ 1. Тестовый параграф\nКороткий текст для проверки llm-парсера.';
    try {
      const res = await this.llm.withSettings(s).parse(sample, { className: '6А', subject: 'Проверка' });
      return { ok: true, topics: res.topics.length, cards: res.cards.length };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

// Экспорт для обратной совместимости тестов/скриптов, ссылавшихся на стаб-разбор напрямую.
export { RegexpParserProvider } from './regexp-parser.provider';
