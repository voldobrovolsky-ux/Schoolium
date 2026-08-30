import { Injectable } from '@nestjs/common';

/** Ответ ASR-сервиса. */
export interface AsrResult {
  text: string;
  confidence: number;
}

/** Типизированная ошибка недоступности/сбоя ASR — контроллер вернёт 503. */
export class AsrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsrUnavailableError';
  }
}

/**
 * Анти-коррупционный фасад к ASR (faster-whisper, отдельный контейнер).
 * POST ${ASR_URL}/transcribe { audio_base64, vocabulary } → { text, confidence }.
 * При сбое/таймауте бросает AsrUnavailableError (журнал деградирует мягко).
 */
@Injectable()
export class AsrClient {
  private readonly baseUrl = process.env.ASR_URL ?? 'http://localhost:8001';
  private readonly timeoutMs = 8000;

  async transcribe(audioBase64: string, vocabulary: string[]): Promise<AsrResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio_base64: audioBase64, vocabulary }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new AsrUnavailableError(
          `ASR ответил статусом ${res.status}`,
        );
      }

      const data = (await res.json()) as Partial<AsrResult>;
      return {
        text: typeof data.text === 'string' ? data.text : '',
        confidence:
          typeof data.confidence === 'number' ? data.confidence : 0,
      };
    } catch (err) {
      if (err instanceof AsrUnavailableError) throw err;
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? 'таймаут запроса к ASR'
          : (err as Error).message;
      throw new AsrUnavailableError(`ASR недоступен: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
