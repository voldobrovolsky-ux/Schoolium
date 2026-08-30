import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { FlorService, type SessionUser } from '../../common/auth/flor.service';

type LoginFlow = {
  purpose: 'login';
  deviceCode: string;
  interval: number;
  expiresAt: number;
};
type KioskFlow = {
  purpose: 'kiosk';
  bindingCode: string;
  interval: number;
  expiresAt: number;
  status: 'pending' | 'confirmed';
  deviceToken?: string;
};
type Flow = LoginFlow | KioskFlow;

export interface AuthorizeResult {
  flowId: string;
  qr: string; // строка для QR-кода
  userCode: string; // короткий код-фолбэк под QR
  verificationUri?: string;
  interval: number; // секунды между опросами
  expiresIn: number; // сек до истечения
}
export type PollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'authenticated'; sid: string }
  | { status: 'bound'; deviceToken: string };

const rand = (bytes = 24) => randomBytes(bytes).toString('base64url');
const bindCode = () => randomBytes(5).toString('hex').toUpperCase(); // 10 hex-символов

/**
 * Device Authorization Flow для главной страницы (см. ТЗ главной).
 * purpose=login — стандартный RFC 8628 через Флёрус (учитель входит с телефона).
 * purpose=kiosk — привязка физического устройства: телефон (уже авторизован)
 * открывает ссылку из QR и подтверждает; киоск получает deviceToken.
 *
 * Поток-состояния держим в памяти — они короткоживущие (минуты), а API
 * разворачивается единственным инстансом (docker-compose.prod). NATS/Redis тут не нужны.
 */
@Injectable()
export class DeviceService {
  private readonly log = new Logger('DeviceFlow');
  private readonly flows = new Map<string, Flow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly flor: FlorService,
  ) {}

  private get webOrigin(): string {
    return (
      process.env.WEB_ORIGIN ??
      process.env.FLOR_POST_LOGOUT_REDIRECT_URI ??
      'https://edustore-flor-group.ru'
    );
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, f] of this.flows) if (f.expiresAt < now) this.flows.delete(id);
  }

  async authorize(purpose: 'login' | 'kiosk'): Promise<AuthorizeResult> {
    this.prune();
    const flowId = rand(16);

    if (purpose === 'login') {
      const d = await this.flor.deviceAuthorize();
      this.flows.set(flowId, {
        purpose: 'login',
        deviceCode: d.device_code,
        interval: d.interval,
        expiresAt: Date.now() + d.expires_in * 1000,
      });
      return {
        flowId,
        qr: d.verification_uri_complete ?? d.verification_uri,
        userCode: d.user_code,
        verificationUri: d.verification_uri,
        interval: d.interval,
        expiresIn: d.expires_in,
      };
    }

    // kiosk: привязка устройства — код подтверждается телефоном (см. bind()).
    const code = bindCode();
    const expiresIn = 600;
    this.flows.set(flowId, {
      purpose: 'kiosk',
      bindingCode: code,
      interval: 3,
      expiresAt: Date.now() + expiresIn * 1000,
      status: 'pending',
    });
    return {
      flowId,
      qr: `${this.webOrigin}/?bind=${code}`,
      userCode: code,
      interval: 3,
      expiresIn,
    };
  }

  async poll(flowId: string): Promise<PollResult> {
    const f = this.flows.get(flowId);
    if (!f || f.expiresAt < Date.now()) {
      if (f) this.flows.delete(flowId);
      return { status: 'expired' };
    }

    if (f.purpose === 'login') {
      const r = await this.flor.pollDeviceToken(f.deviceCode).catch((e) => {
        this.log.warn(`device login poll failed: ${(e as Error).message}`);
        return null;
      });
      if (r) {
        this.flows.delete(flowId);
        return { status: 'authenticated', sid: r.sid };
      }
      return { status: 'pending' };
    }

    if (f.status === 'confirmed' && f.deviceToken) {
      this.flows.delete(flowId);
      return { status: 'bound', deviceToken: f.deviceToken };
    }
    return { status: 'pending' };
  }

  /** Подтверждение привязки с авторизованного телефона: создаёт Device под организацией. */
  async bind(code: string, user: SessionUser | undefined): Promise<{ ok: true; deviceName: string }> {
    this.prune();
    const entry = [...this.flows.entries()].find(
      ([, f]) => f.purpose === 'kiosk' && f.status === 'pending' && f.bindingCode === code,
    );
    if (!entry) throw new NotFoundException('код привязки не найден или истёк');
    const flow = entry[1] as KioskFlow;

    // школа: из сессии телефона (workspaceId); в DEV — из tenant-контекста запроса
    const workspaceId = user?.workspaceId ?? TenantContext.current();
    if (!workspaceId) throw new ForbiddenException('нет школы для привязки устройства');

    const deviceToken = rand(32);
    const name = `Устройство · ${new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}`;
    await this.prisma.device.create({
      data: { workspaceId, name, deviceToken, boundByUserId: user?.florusUserId ?? null },
    });

    flow.status = 'confirmed';
    flow.deviceToken = deviceToken;
    return { ok: true, deviceName: name };
  }
}
