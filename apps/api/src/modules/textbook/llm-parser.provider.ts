import { Injectable, Logger } from '@nestjs/common';
import type { ParserContext, ParserProvider, ParserProviderResult, ParsedProviderCard, ParsedProviderTopic } from './parser-provider';
import type { ParserSettings } from './parser-settings.service';

/**
 * КОНТРАКТ ОТВЕТА LLM-ПРОВАЙДЕРА (используется и в системном промпте для LLM):
 *
 * {
 *   topics: [{ title: string, order: number, sourcePage?: number }],
 *   cards: [{
 *     topicTitle: string,    // связь с темой по title, не по id
 *     content: string,       // текст карточки / задачи / конспекта
 *     order: number,
 *     sourcePage?: number
 *   }]
 * }
 *
 * Связь cards → topics — через topicTitle, чтобы не завязывать LLM на внутренние id.
 * Эндпоинт — OpenAI-совместимый chat/completions (endpointUrl/apiKey/modelName из настроек
 * воркспейса); принимаем как JSON в choices[0].message.content, так и «голый» JSON-ответ
 * кастомного эндпоинта по тому же контракту.
 */
const SYSTEM_PROMPT = `Ты — парсер школьных учебников. На вход даётся текст учебника (класс и предмет — в контексте).
Разбей его на темы (главы/разделы) и карточки (параграфы/задачи/конспекты по темам).
Ответь СТРОГО одним JSON-объектом без пояснений по контракту:
{"topics":[{"title":"...","order":1,"sourcePage":1}],"cards":[{"topicTitle":"...","content":"...","order":1,"sourcePage":1}]}
Поле cards[].topicTitle должно ТОЧНО совпадать с topics[].title соответствующей темы. sourcePage опционален.`;

const TIMEOUT_MS = 60_000;
const MAX_EXTRACT_CHARS = 100_000; // защита от гигантских учебников в один запрос (v1)

@Injectable()
export class LlmParserProvider implements ParserProvider {
  private readonly log = new Logger('LlmParserProvider');
  private settings: ParserSettings | null = null;

  /** Настройки воркспейса передаются перед вызовом (провайдер per-request, без состояния между). */
  withSettings(settings: ParserSettings): LlmParserProvider {
    const p = new LlmParserProvider();
    p.settings = settings;
    return p;
  }

  async parse(textExtract: string, context: ParserContext): Promise<ParserProviderResult> {
    const s = this.settings;
    if (!s?.endpointUrl) throw new Error('llm-парсер: endpointUrl не настроен');
    if (!s.apiKey) throw new Error('llm-парсер: apiKey не настроен');

    const userPayload = {
      className: context.className,
      subject: context.subject,
      textExtract: textExtract.slice(0, MAX_EXTRACT_CHARS),
    };
    const body = {
      model: s.modelName ?? undefined,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(s.endpointUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      throw new Error(`llm-парсер: эндпоинт ответил ${resp.status}`);
    }
    const raw: unknown = await resp.json();
    return this.toResult(raw);
  }

  /** Разбор ответа по контракту: OpenAI-обёртка ИЛИ голый JSON. Невалидно → throw (→ fallback). */
  private toResult(raw: unknown): ParserProviderResult {
    let obj: unknown = raw;
    const choice = (raw as { choices?: { message?: { content?: string } }[] })?.choices?.[0];
    if (choice?.message?.content !== undefined) {
      // OpenAI-совместимая обёртка: JSON лежит строкой в message.content (возможно в ```-фенсах)
      const text = choice.message.content.replace(/^```(json)?\s*/i, '').replace(/\s*```\s*$/, '');
      obj = JSON.parse(text);
    }
    const o = obj as { topics?: unknown; cards?: unknown };
    if (!Array.isArray(o?.topics) || !Array.isArray(o?.cards)) {
      throw new Error('llm-парсер: ответ не соответствует контракту (нет topics[]/cards[])');
    }
    const topics: ParsedProviderTopic[] = (o.topics as Record<string, unknown>[])
      .filter((t) => typeof t?.title === 'string' && (t.title as string).trim())
      .map((t, i) => ({
        title: (t.title as string).trim(),
        order: typeof t.order === 'number' ? t.order : i + 1,
        sourcePage: typeof t.sourcePage === 'number' ? t.sourcePage : undefined,
      }));
    const cards: ParsedProviderCard[] = (o.cards as Record<string, unknown>[])
      .filter((c) => typeof c?.content === 'string' && (c.content as string).trim())
      .map((c, i) => {
        const content = (c.content as string).trim();
        return {
          topicTitle: typeof c.topicTitle === 'string' && c.topicTitle.trim() ? c.topicTitle.trim() : null,
          title: content.split('\n')[0].slice(0, 80), // короткий заголовок для списков UI
          content,
          order: typeof c.order === 'number' ? c.order : i + 1,
          sourcePage: typeof c.sourcePage === 'number' ? c.sourcePage : undefined,
        };
      });
    if (topics.length === 0 && cards.length === 0) {
      throw new Error('llm-парсер: пустой ответ (0 тем и 0 карт)');
    }
    topics.sort((a, b) => a.order - b.order);
    cards.sort((a, b) => a.order - b.order);
    this.log.log(`llm-парсер: тем=${topics.length}, карт=${cards.length}`);
    return { topics, cards };
  }
}
