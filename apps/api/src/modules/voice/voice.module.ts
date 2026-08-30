import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { AsrClient } from './asr.client';

/** Модуль «голос»: голосовой ввод → ASR → дизамбигуация однофамильцев. */
@Module({
  controllers: [VoiceController],
  providers: [VoiceService, AsrClient],
  exports: [VoiceService, AsrClient],
})
export class VoiceModule {}
