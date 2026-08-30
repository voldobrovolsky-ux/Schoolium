import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { ParserSettingsService } from './parser-settings.service';
import { ParserService } from './parser.service';
import { RequirePermission } from '../../common/authz/require-permission.decorator';

interface PutBody {
  provider?: string; // regexp | llm
  endpointUrl?: string | null;
  apiKey?: string; // undefined — не трогаем; '' — стереть; иначе — зашифровать и сохранить
  modelName?: string | null;
}

/**
 * Админ-раздел «Парсер учебников» (настройки воркспейса): переключатель провайдера + три поля llm.
 * Аутентификация обязательна (глобальный AuthGuard); отдельного Permission нет — как у прочих
 * админ-поверхностей (structure/devices): админ — tenancy-роль Флёра, в пакеты прав не входит.
 * apiKey шифруется при хранении и в GET не возвращается (только маска sk-***).
 */
@Controller('v1/admin/parser-settings')
export class ParserSettingsController {
  constructor(
    private readonly settings: ParserSettingsService,
    private readonly parser: ParserService,
  ) {}

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  @Get()
  get() {
    return this.settings.getView();
  }

  @RequirePermission('settings.parser.manage')
  @Put()
  put(@Body() body: PutBody, @Req() req: Request & { user?: SessionUser }) {
    return this.settings.put(body, this.actor(req));
  }

  /** «Проверить соединение»: короткий тестовый текст в настроенный эндпоинт → OK / текст ошибки. */
  @RequirePermission('settings.parser.manage')
  @Post('test')
  test() {
    return this.parser.testLlmConnection();
  }
}
