import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { GraphService } from './graph.service';
import { ChannelService } from './channel.service';
import { MessageService } from './message.service';
import { AnnouncementService } from './announcement.service';
import { ParenthoodSync } from './parenthood.sync';
import { CommController } from './comm.controller';
import { ChannelController } from './channel.controller';

// Communitoria (Phase 1). Чанк 1: граф контактов + инварианты безопасности миноров. Чанк 2: каналы/
// сообщения/объявления поверх того же инварианта (add-participant не дублируется). Контур comm/
// изолирован от Документохранилища. ParenthoodSync — зеркало директории Флёруса. Звонки — чанк 3.
@Module({
  imports: [PrismaModule],
  controllers: [CommController, ChannelController],
  providers: [GraphService, ChannelService, MessageService, AnnouncementService, ParenthoodSync],
  exports: [GraphService, ChannelService, MessageService, AnnouncementService, ParenthoodSync],
})
export class CommModule {}
