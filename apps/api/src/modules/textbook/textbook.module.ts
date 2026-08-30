import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { DocModule } from '../doc/doc.module';
import { MaterialService } from './material.service';
import { ParserService } from './parser.service';
import { ParserHandlers } from './parser.handlers';
import { TextbookController } from './textbook.controller';
import { RegexpParserProvider } from './regexp-parser.provider';
import { LlmParserProvider } from './llm-parser.provider';
import { ParserSettingsService } from './parser-settings.service';
import { ParserSettingsController } from './parser-settings.controller';

// Учебники + парсер (Phase 1): загрузка учебника поверх Документохранилища (DocModule) + разбор
// textExtract на темы/карты по doc.file.enriched → textbook.parsed. Разбор — через ParserProvider
// (regexp-стаб по умолчанию | llm из настроек воркспейса, fallback на regexp). Outbox/EventBus — из EventsModule.
@Module({
  imports: [PrismaModule, DocModule],
  controllers: [TextbookController, ParserSettingsController],
  providers: [MaterialService, ParserService, ParserHandlers, RegexpParserProvider, LlmParserProvider, ParserSettingsService],
  exports: [MaterialService, ParserService, ParserSettingsService],
})
export class TextbookModule {}
