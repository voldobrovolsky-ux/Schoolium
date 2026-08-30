import { BadRequestException, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';

export type ParserProviderKind = 'regexp' | 'llm';

export interface ParserSettings {
  provider: ParserProviderKind;
  endpointUrl: string | null;
  modelName: string | null;
  apiKey: string | null; // расшифрованный (только для внутреннего использования — наружу НЕ отдаётся)
}

export interface ParserSettingsView {
  provider: ParserProviderKind;
  endpointUrl: string | null;
  modelName: string | null;
  apiKeyMask: string | null; // 'sk-***' если ключ задан; сам ключ обратно не отдаём
}

const API_KEY_MASK = 'sk-***';

// AES-256-GCM: ключ из ENV (SETTINGS_ENC_KEY); дев-дефолт позволяет работать без конфигурации,
// в проде ключ ОБЯЗАН быть задан (секрет-стор). Формат хранения: base64(iv|tag|ciphertext).
const encKey = () => scryptSync(process.env.SETTINGS_ENC_KEY ?? 'edustore-dev-settings-key', 'edustore-ws-settings', 32);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Настройки парсера учебников на воркспейс (WorkspaceSettings, школьный синглтон):
 * выбор провайдера (regexp | llm) + endpointUrl/apiKey/modelName для llm.
 * apiKey шифруется при хранении (AES-256-GCM) и НЕ отдаётся в GET (только маска sk-***).
 */
@Injectable()
export class ParserSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Полные настройки с расшифрованным ключом — ТОЛЬКО для LlmParserProvider (не для API). */
  async getForWorkspace(workspaceId: string): Promise<ParserSettings> {
    const row = await this.prisma.workspaceSettings.findUnique({ where: { workspaceId } });
    return {
      provider: row?.parserProvider === 'llm' ? 'llm' : 'regexp',
      endpointUrl: row?.parserEndpointUrl ?? null,
      modelName: row?.parserModelName ?? null,
      apiKey: row?.parserApiKeyEnc ? decryptSecret(row.parserApiKeyEnc) : null,
    };
  }

  /** Представление для админки: без ключа, только маска. */
  async getView(): Promise<ParserSettingsView> {
    const ws = TenantContext.require();
    const row = await this.prisma.workspaceSettings.findUnique({ where: { workspaceId: ws } });
    return {
      provider: row?.parserProvider === 'llm' ? 'llm' : 'regexp',
      endpointUrl: row?.parserEndpointUrl ?? null,
      modelName: row?.parserModelName ?? null,
      apiKeyMask: row?.parserApiKeyEnc ? API_KEY_MASK : null,
    };
  }

  /**
   * Правка настроек. apiKey: undefined — не трогаем; '' — стираем; иначе — шифруем и сохраняем.
   * Ключ никогда не логируется и не возвращается.
   */
  async put(
    input: { provider?: string; endpointUrl?: string | null; apiKey?: string; modelName?: string | null },
    actor: string,
  ): Promise<ParserSettingsView> {
    const ws = TenantContext.require();
    if (input.provider !== undefined && input.provider !== 'regexp' && input.provider !== 'llm') {
      throw new BadRequestException('provider: regexp | llm');
    }
    const data: Record<string, unknown> = { updatedBy: actor };
    if (input.provider !== undefined) data.parserProvider = input.provider;
    if (input.endpointUrl !== undefined) data.parserEndpointUrl = input.endpointUrl || null;
    if (input.modelName !== undefined) data.parserModelName = input.modelName || null;
    if (input.apiKey !== undefined) data.parserApiKeyEnc = input.apiKey === '' ? null : encryptSecret(input.apiKey);
    await this.prisma.workspaceSettings.upsert({
      where: { workspaceId: ws },
      update: data,
      create: { workspaceId: ws, ...data },
    });
    return this.getView();
  }
}
