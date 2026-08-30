import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  GradeValue,
  VoiceCandidate,
  VoiceGradeResponse,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AsrClient } from './asr.client';
import { VoiceGradeDto } from './dto/voice-grade.dto';

/** Минимальная длина основы фамилии для сопоставления (учёт падежей). */
const STEM_LEN = 5;

/** Словесные оценки → значение ячейки. */
const WORD_GRADES: Record<string, GradeValue> = {
  два: '2',
  двойка: '2',
  три: '3',
  тройка: '3',
  четыре: '4',
  четвёрка: '4',
  четверка: '4',
  пять: '5',
  пятёрка: '5',
  пятерка: '5',
};

/**
 * Домен «голос»: аудио → ASR → разбор оценки и фамилии → дизамбигуация
 * однофамильцев. ASR изолирован; при его недоступности бросаем ошибку,
 * контроллер возвращает 503, фронт переходит на ручной ввод.
 */
@Injectable()
export class VoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asr: AsrClient,
  ) {}

  async grade(dto: VoiceGradeDto): Promise<VoiceGradeResponse> {
    const klass = await this.prisma.class.findUnique({
      where: { id: dto.classId },
      include: { students: { orderBy: { number: 'asc' } } },
    });
    if (!klass) {
      throw new NotFoundException(`Класс ${dto.classId} не найден`);
    }

    // Словарь для constrained-ASR: фамилии + полные имена класса.
    const vocabulary = buildVocabulary(klass.students);

    // Может бросить AsrUnavailableError → 503 в контроллере.
    const asr = await this.asr.transcribe(dto.audio, vocabulary);
    const transcript = asr.text ?? '';

    const grade = parseGrade(transcript);
    const surname = parseSurname(transcript);
    const candidates = matchCandidates(surname, klass.label, klass.students);

    return {
      transcript,
      grade,
      confidence: asr.confidence ?? 0,
      candidates,
    };
  }
}

/** Словарь для ASR: фамилии и полные отображаемые имена. */
function buildVocabulary(
  students: { lastName: string; displayName: string }[],
): string[] {
  const set = new Set<string>();
  for (const s of students) {
    if (s.lastName) set.add(s.lastName);
    if (s.displayName) set.add(s.displayName);
  }
  return [...set];
}

/** Нормализация: нижний регистр, ё→е, обрезка пунктуации. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Основа слова для сравнения фамилий (учёт падежных окончаний). */
function stem(word: string): string {
  return normalize(word).slice(0, STEM_LEN);
}

/** Извлекает оценку из транскрипта: цифры 2-5, слова, "н"/отсут*. */
function parseGrade(transcript: string): GradeValue {
  const norm = normalize(transcript);
  const tokens = norm.split(' ');

  for (const t of tokens) {
    // Отсутствие.
    if (t === 'н' || t.startsWith('отсут') || t === 'нет') return 'н';
    // Цифра 2..5.
    if (/^[2-5]$/.test(t)) return t as GradeValue;
    // Слово-оценка.
    if (WORD_GRADES[t]) return WORD_GRADES[t];
  }
  return '';
}

/** Извлекает кандидата-фамилию: самое длинное «словесное» слово (не оценка). */
function parseSurname(transcript: string): string {
  const norm = normalize(transcript);
  const tokens = norm.split(' ').filter(Boolean);

  const words = tokens.filter(
    (t) =>
      /^[а-я]+$/.test(t) &&
      t.length >= 3 &&
      !WORD_GRADES[t] &&
      t !== 'отсутствует' &&
      !t.startsWith('отсут') &&
      t !== 'нет',
  );
  if (!words.length) return '';
  // Фамилия обычно первое значимое слово; берём его.
  return words[0];
}

/** Кандидаты: все ученики, чья фамилия совпадает по основе. */
function matchCandidates(
  surname: string,
  classLabel: string,
  students: { id: string; displayName: string; lastName: string }[],
): VoiceCandidate[] {
  if (!surname) return [];
  const target = stem(surname);

  return students
    .filter((s) => stem(s.lastName) === target)
    .map((s) => ({
      studentId: s.id,
      name: s.displayName,
      sub: `${classLabel} · в журнале`,
    }));
}
