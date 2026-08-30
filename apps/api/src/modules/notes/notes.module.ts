import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { VoiceModule } from '../voice/voice.module';

/**
 * Модуль «заметки» (скелет): устные заметки учителя.
 * Зависит от VoiceModule ради публичного ASR-фасада (границы соблюдены).
 */
@Module({
  imports: [VoiceModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
