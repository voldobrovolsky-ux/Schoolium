/**
 * Абстракция провайдера разбора учебника. ParserService выбирает реализацию по настройке
 * воркспейса (WorkspaceSettings.parserProvider: regexp | llm, дефолт regexp) и при падении
 * llm откатывается на regexp (загрузка не роняется — деградация с логом).
 *
 * Связь cards → topics — по topicTitle (НЕ по внутренним id), чтобы не завязывать внешний
 * LLM на наши идентификаторы.
 */
export interface ParsedProviderTopic {
  title: string;
  order: number;
  sourcePage?: number;
}

export interface ParsedProviderCard {
  topicTitle: string | null; // связь с темой по title; null — карта вне тем
  title: string; // короткий заголовок карты (для списков UI)
  content: string; // текст карточки / задачи / конспекта
  order: number;
  sourcePage?: number;
}

export interface ParserProviderResult {
  topics: ParsedProviderTopic[];
  cards: ParsedProviderCard[];
}

export interface ParserContext {
  className: string | null; // «6А» — из TeachingAssignment загружавшего
  subject: string | null; // «Математика»
}

export interface ParserProvider {
  parse(textExtract: string, context: ParserContext): Promise<ParserProviderResult>;
}
