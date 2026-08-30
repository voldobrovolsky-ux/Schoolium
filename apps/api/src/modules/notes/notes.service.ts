import { Injectable } from '@nestjs/common';
import type { TeacherNote } from '@prisma/client';
import type { TeacherNoteRequest } from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AsrClient, AsrUnavailableError } from '../voice/asr.client';

/**
 * Домен «заметки» (скелет): устная/текстовая заметка учителя.
 * Если пришёл текст — берём его; если аудио — пробуем распознать через ASR,
 * при недоступности ASR сохраняем заметку как необработанную (мягкая деградация).
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asr: AsrClient,
  ) {}

  async create(
    dto: TeacherNoteRequest,
    teacherId: string,
  ): Promise<TeacherNote> {
    let transcription = dto.text?.trim() ?? '';
    let audioUrl: string | null = null;
    let processed = transcription.length > 0;

    if (!transcription && dto.audio) {
      audioUrl = '/files/stub/note-audio';
      try {
        const asr = await this.asr.transcribe(dto.audio, []);
        transcription = asr.text ?? '';
        processed = transcription.length > 0;
      } catch (err) {
        if (err instanceof AsrUnavailableError) {
          // ASR недоступен — сохраняем «сырую» заметку для последующей обработки.
          transcription = '';
          processed = false;
        } else {
          throw err;
        }
      }
    }

    // Если указан ровно один ученик — привязываем заметку к нему.
    const studentId =
      dto.studentIds && dto.studentIds.length === 1
        ? dto.studentIds[0]
        : null;

    return this.prisma.teacherNote.create({
      data: {
        workspaceId: TenantContext.require(), // тенант = школа учителя (активный контекст)
        teacherId,
        studentId,
        lessonId: dto.lessonId ?? null,
        audioUrl,
        transcription,
        processed,
      },
    });
  }
}
