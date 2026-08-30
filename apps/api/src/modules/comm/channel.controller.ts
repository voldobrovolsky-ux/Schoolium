import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { OutboxDispatcher } from '../../common/outbox/outbox.dispatcher';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { ChannelService } from './channel.service';
import { MessageService } from './message.service';
import { AnnouncementService } from './announcement.service';
import { CHANNEL_KINDS, PARTICIPANT_ROLES, type ParticipantRole } from './comm.contract';

interface CreateChannelBody { kind: string; title?: string; scope?: string; classId?: string; moderators?: string[] }
interface AddMemberBody { userId?: string; studentId?: string; role: string }
interface PostMessageBody { mode?: string; kind?: string; body?: string; replyToId?: string; attachmentIds?: string[] }
interface EditBody { body: string }
interface ReactionBody { emoji: string }
interface AnnouncementBody { body: string; audience: string; ackDeadline?: string }

// Communitoria каналы/сообщения/объявления — /api/v1/comm/*. Гейты: comm.channel.manage (создание),
// comm.announcement.post (объявления, завуч); добавление участника — resource-level модератор канала.
@Controller('v1/comm')
export class ChannelController {
  constructor(
    private readonly channels: ChannelService,
    private readonly messages: MessageService,
    private readonly announcements: AnnouncementService,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  private async assertModerator(channelId: string, userId: string) {
    if (!(await this.channels.isModerator(channelId, userId))) {
      throw new ForbiddenException({ code: 'NOT_CHANNEL_MODERATOR', message: 'нужны права модератора канала' });
    }
  }

  // ─── Каналы ───
  @RequirePermission('comm.channel.manage')
  @Post('channels')
  createChannel(@Body() body: CreateChannelBody, @Req() req: Request & { user?: SessionUser }) {
    if (!(CHANNEL_KINDS as readonly string[]).includes(body.kind)) {
      throw new BadRequestException(`недопустимый kind канала: ${body.kind}`);
    }
    return this.channels.createChannel(body, this.actor(req)); // создатель → первый модератор
  }

  @Get('channels')
  listChannels(@Query('folder') folder?: string) {
    return this.channels.listChannels({ kind: folder });
  }

  @Get('channels/:id')
  getChannel(@Param('id') id: string) {
    return this.channels.getChannel(id);
  }

  /** Добавить участника — модератор канала; ПЕРЕИСПОЛЬЗУЕТ чанк-1 инвариант (minorPresent-rejects-external). */
  @Post('channels/:id/members')
  async addMember(@Param('id') id: string, @Body() body: AddMemberBody, @Req() req: Request & { user?: SessionUser }) {
    await this.assertModerator(id, this.actor(req));
    if (!(PARTICIPANT_ROLES as readonly string[]).includes(body.role)) {
      throw new BadRequestException(`недопустимый role: ${body.role}`);
    }
    return this.channels.addParticipant(id, { userId: body.userId, studentId: body.studentId, role: body.role as ParticipantRole });
  }

  // ─── Сообщения ───
  @Get('channels/:id/messages')
  listMessages(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.messages.listMessages(id, { cursor, limit: limit ? Number(limit) : undefined });
  }

  @Post('channels/:id/messages')
  async postMessage(@Param('id') id: string, @Body() body: PostMessageBody, @Req() req: Request & { user?: SessionUser }) {
    const msg = await this.messages.postMessage(id, this.actor(req), body); // mode ОБЯЗАТЕЛЕН (иначе 400)
    await this.dispatcher.drain();
    return msg;
  }

  @Patch('messages/:id')
  editMessage(@Param('id') id: string, @Body() body: EditBody) {
    return this.messages.editMessage(id, body.body);
  }

  @Post('messages/:id/reactions')
  react(@Param('id') id: string, @Body() body: ReactionBody, @Req() req: Request & { user?: SessionUser }) {
    return this.messages.addReaction(id, this.actor(req), body.emoji);
  }

  /** Advisory-подсказка режима — НЕ создаёт сообщение и НЕ применяет mode (mode задаёт отправитель). */
  @Post('messages/suggest-mode')
  suggestMode(@Body() body: { body?: string }) {
    return this.messages.suggestMode(body.body ?? '');
  }

  // ─── Объявления ───
  @RequirePermission('comm.announcement.post')
  @Post('channels/:id/announcements')
  async postAnnouncement(@Param('id') id: string, @Body() body: AnnouncementBody, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.announcements.postAnnouncement(id, this.actor(req), body);
    await this.dispatcher.drain();
    return res;
  }

  @Post('announcements/:id/ack')
  async ack(@Param('id') id: string, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.announcements.recordAck(id, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @Get('announcements/:id/acks')
  listAcks(@Param('id') id: string) {
    return this.announcements.listAcks(id);
  }
}
