import { Injectable } from '@nestjs/common';
import type { ParserContext, ParserProvider, ParserProviderResult, ParsedProviderCard, ParsedProviderTopic } from './parser-provider';

// Структурные маркеры учебника (реально встречаются в textExtract): темы и параграфы-карты.
const TOPIC_RE = /^(глава|тема|раздел)\s+\d+/i; // «Глава 1. Векторы», «Тема 3 …», «Раздел 2»
const CARD_RE = /^§\s*\d+/; // «§ 1. Понятие вектора»

/**
 * Детерминированный разбор textExtract по структурным маркерам «Глава/§» — стаб-провайдер
 * (0 ИИ) и дефолт. Также точка fallback для LlmParserProvider (упал llm → сюда).
 */
@Injectable()
export class RegexpParserProvider implements ParserProvider {
  async parse(textExtract: string, _context: ParserContext): Promise<ParserProviderResult> {
    const topics: ParsedProviderTopic[] = [];
    const cards: ParsedProviderCard[] = [];
    let curTopicTitle: string | null = null;
    let cur: { title: string; topicTitle: string | null; lines: string[] } | null = null;
    const flush = () => {
      if (cur) {
        cards.push({
          topicTitle: cur.topicTitle,
          title: cur.title,
          content: cur.lines.join('\n'),
          order: cards.length + 1,
        });
        cur = null;
      }
    };
    for (const raw of textExtract.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (TOPIC_RE.test(line)) {
        flush();
        topics.push({ order: topics.length + 1, title: line });
        curTopicTitle = line;
      } else if (CARD_RE.test(line)) {
        flush();
        cur = { title: line, topicTitle: curTopicTitle, lines: [] };
      } else if (cur) {
        cur.lines.push(line);
      }
    }
    flush();
    return { topics, cards };
  }
}
