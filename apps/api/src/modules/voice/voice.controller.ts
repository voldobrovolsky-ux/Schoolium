import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { VoiceGradeResponse } from '@edustore/shared';
import { VoiceService } from './voice.service';
import { AsrUnavailableError } from './asr.client';
import { VoiceGradeDto } from './dto/voice-grade.dto';
import { RequirePermission } from '../../common/authz/require-permission.decorator';

// /api/voice/*
@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  /**
   * POST /api/voice/grade — распознать оценку и фамилию.
   * Если ASR недоступен — 503, фронт переходит на ручной ввод.
   */
  @RequirePermission('journal.grades.edit')
  @Post('grade')
  async grade(@Body() dto: VoiceGradeDto): Promise<VoiceGradeResponse> {
    try {
      return await this.voiceService.grade(dto);
    } catch (err) {
      if (err instanceof AsrUnavailableError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message:
              'Сервис распознавания речи недоступен. Используйте ручной ввод оценки.',
            error: 'Service Unavailable',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw err;
    }
  }
}
