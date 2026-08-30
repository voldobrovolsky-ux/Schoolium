import { IsString } from 'class-validator';
import type { VoiceGradeRequest } from '@edustore/shared';

/** Тело POST /voice/grade — аудио + контекст класса/урока. */
export class VoiceGradeDto implements VoiceGradeRequest {
  @IsString()
  audio!: string; // base64

  @IsString()
  classId!: string;

  @IsString()
  lessonId!: string;
}
