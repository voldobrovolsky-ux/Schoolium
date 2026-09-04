import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SetAccessPolicyDto, UpsertAssetDto, UpsertNetworkDto } from '@edustore/shared';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import type { SessionUser } from '../../common/auth/flor.service';
import { actorOf } from '../actor';
import { AdminCabinetService } from './admin-cabinet.service';

type Req0 = Request & { user?: SessionUser; sessionId?: string };

/**
 * Кабинет администратора `S-62` (AR-186…AR-189). Каждый маршрут — за правом
 * `school.admin`, которое держит ТОЛЬКО администратор: модератор кабинет не
 * открывает (G-81). Мутации — строки 40–48 таблицы `70-screens.md` §11, и
 * каждая ложится в аудит с идентичностью администратора (G-41).
 */
@Controller('v1/admin')
export class AdminCabinetController {
  constructor(private readonly svc: AdminCabinetService) {}

  @RequirePermission('school.admin')
  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  /** `S-62.map.devices`: люди школы и их живые сессии (AR-187). */
  @RequirePermission('school.admin')
  @Get('devices')
  devices(@Req() req: Req0) {
    return this.svc.devices(req.sessionId ?? null);
  }

  /** `S-62.list.connections`: журнал подключений — человека либо всей школы. */
  @RequirePermission('school.admin')
  @Get('connections')
  connections(@Req() req: Req0, @Query('userId') userId?: string) {
    return this.svc.connections(userId?.trim() || null, req.sessionId ?? null);
  }

  /** §11 строка 40 · адресный отзыв сессии из карты устройств. */
  @RequirePermission('school.admin')
  @Post('sessions/:sid/revoke')
  revokeSession(@Req() req: Req0, @Param('sid') sid: string) {
    return this.svc.revokeSession(sid, actorOf(req));
  }

  /** §11 строка 41 · `M-28` инцидент-режим: все сессии школы, кроме текущей (AR-188). */
  @RequirePermission('school.admin')
  @Post('sessions/revoke-all')
  revokeAll(@Req() req: Req0) {
    return this.svc.revokeAll(req.sessionId ?? null, actorOf(req));
  }

  @RequirePermission('school.admin')
  @Get('policy')
  policy() {
    return this.svc.policy();
  }

  /** §11 строка 42 · лимиты сессий по ролям (AR-188) и носителей ролей (AR-205): `sessionLimits` + `roleLimits`. */
  @RequirePermission('school.admin')
  @Put('policy')
  setPolicy(@Req() req: Req0, @Body() body: SetAccessPolicyDto) {
    return this.svc.setPolicy(body, actorOf(req));
  }

  /** `S-62.audit`: последние 200 строк леджера школы — все действующие, не только свои. */
  @RequirePermission('school.admin')
  @Get('audit')
  audit() {
    return this.svc.audit(200);
  }

  // ─── реестр Wi-Fi сетей (§11 строки 43–45) ───

  @RequirePermission('school.admin')
  @Get('networks')
  networks() {
    return this.svc.listNetworks();
  }

  @RequirePermission('school.admin')
  @Post('networks')
  createNetwork(@Req() req: Req0, @Body() body: UpsertNetworkDto) {
    return this.svc.createNetwork(body, actorOf(req));
  }

  @RequirePermission('school.admin')
  @Put('networks/:id')
  updateNetwork(@Req() req: Req0, @Param('id') id: string, @Body() body: UpsertNetworkDto) {
    return this.svc.updateNetwork(id, body, actorOf(req));
  }

  @RequirePermission('school.admin')
  @Delete('networks/:id')
  deleteNetwork(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.deleteNetwork(id, actorOf(req));
  }

  // ─── реестр корпоративных устройств (§11 строки 46–48) ───

  @RequirePermission('school.admin')
  @Get('assets')
  assets() {
    return this.svc.listAssets();
  }

  @RequirePermission('school.admin')
  @Post('assets')
  createAsset(@Req() req: Req0, @Body() body: UpsertAssetDto) {
    return this.svc.createAsset(body, actorOf(req));
  }

  @RequirePermission('school.admin')
  @Put('assets/:id')
  updateAsset(@Req() req: Req0, @Param('id') id: string, @Body() body: UpsertAssetDto) {
    return this.svc.updateAsset(id, body, actorOf(req));
  }

  @RequirePermission('school.admin')
  @Delete('assets/:id')
  deleteAsset(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.deleteAsset(id, actorOf(req));
  }
}
