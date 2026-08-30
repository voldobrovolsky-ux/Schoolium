import pdfParse from 'pdf-parse';

/**
 * Экстракция текстового слоя при обогащении файла (raw→enriched).
 * PDF — текстовый слой через pdf-parse (без OCR: сканы без слоя дадут пусто — деградация,
 * файл остаётся доступен и ищется по имени/scope). text/* — как есть (UTF-8).
 * Реальный Vision-OCR/классификация — внешний пайплайн (позже), это его лёгкая часть.
 */
export async function extractText(body: Buffer, mime: string | null): Promise<string | null> {
  if (!mime) return null;
  if (mime === 'application/pdf') {
    const parsed = await pdfParse(body);
    const text = parsed.text?.trim();
    return text ? text : null;
  }
  if (mime.startsWith('text/')) {
    const text = body.toString('utf8').trim();
    return text ? text : null;
  }
  return null; // прочие форматы — без экстракции (ждут внешнего OCR)
}
