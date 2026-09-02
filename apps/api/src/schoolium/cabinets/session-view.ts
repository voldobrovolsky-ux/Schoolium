import { ACCESS_PARAMS, type AdminSessionDto, type SessionRevokeReason } from '@edustore/shared';

/**
 * Проекция строки `AppSession` в `AdminSessionDto` (AR-187) — ОДНО место на
 * карту устройств `S-62`, журнал подключений и активность карточки `M-06`:
 * три экрана читают одни и те же слова про одну и ту же сессию.
 */
export interface SessionRow {
  id: string;
  userId: string;
  deviceHint: string;
  via: string;
  clientKind: string;
  ip: string | null;
  parentSessionId: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export const isLive = (s: SessionRow, now: Date): boolean => s.revokedAt === null && s.expiresAt > now;

export const isOnline = (s: SessionRow, now: Date): boolean =>
  isLive(s, now) && now.getTime() - s.lastSeenAt.getTime() <= ACCESS_PARAMS.sessionOnlineMinutes * 60_000;

/**
 * Сеть адреса: для IPv4 — префикс /24 (три первых октета), для IPv6 — четыре
 * первых группы (/64: так провайдеры выдают адреса домам и телефонам).
 * «Новая сеть» сравнивает именно сети, а не адреса: за одним роутером школы
 * адреса меняются, сеть — нет.
 */
export function networkOf(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  if (ip.includes(':')) return expandV6(ip).slice(0, 4).join(':');
  return ip;
}

/**
 * IPv6 в восемь групп: `::` раскрывается нулями, ведущие нули групп и зона
 * (`%eth0`) снимаются, регистр — нижний. Без этого `2001:db8::1` и
 * `2001:db8::2` разбивались бы на разные «сети»: у сжатого адреса первые
 * четыре куска — не первые четыре группы.
 */
function expandV6(ip: string): string[] {
  const bare = ip.split('%')[0].toLowerCase();
  const norm = (g: string): string => (/^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16).toString(16) : g);
  const [head, tail] = bare.split('::');
  const left = head ? head.split(':').map(norm) : [];
  const right = tail ? tail.split(':').map(norm) : [];
  if (tail === undefined) return left;
  const zeros = Math.max(0, 8 - left.length - right.length);
  return [...left, ...Array<string>(zeros).fill('0'), ...right];
}

/**
 * Сессии ОДНОГО человека → DTO. `newNetwork` ставится сессии, чья сеть не
 * встречалась ни в одной более РАННЕЙ его сессии (по `createdAt`), поэтому на
 * вход подаются все сессии человека, включая завершённые: живые в отрыве от
 * истории объявили бы «новой сетью» любой первый вход после чистки журнала.
 * Возвращаются самые новые первыми.
 */
export function sessionsOfUser(rows: SessionRow[], now: Date, currentSessionId: string | null = null): AdminSessionDto[] {
  const asc = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seen = new Set<string>();
  const out: AdminSessionDto[] = [];
  for (const s of asc) {
    const net = networkOf(s.ip);
    const newNetwork = net !== null && !seen.has(net);
    if (net) seen.add(net);
    out.push(toAdminSession(s, now, newNetwork, s.id === currentSessionId));
  }
  return out.reverse();
}

/**
 * Адрес входа виден только администратору (AR-194): карточка `M-06` открыта и
 * модератору (`staff.manage`), поэтому её проекция стирает `ip` и признак
 * «новая сеть», который из адреса выведен.
 */
export function withoutAddress(list: AdminSessionDto[]): AdminSessionDto[] {
  return list.map((s) => ({ ...s, ip: null, newNetwork: false }));
}

export function toAdminSession(s: SessionRow, now: Date, newNetwork: boolean, current = false): AdminSessionDto {
  return {
    id: s.id,
    userId: s.userId,
    deviceHint: s.deviceHint || 'устройство',
    via: s.via as AdminSessionDto['via'],
    clientKind: s.clientKind as AdminSessionDto['clientKind'],
    ip: s.ip,
    newNetwork,
    current,
    parentSessionId: s.parentSessionId,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    status: isLive(s, now) ? 'active' : 'ended',
    online: isOnline(s, now),
    revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
    revokedReason: (s.revokedReason as SessionRevokeReason | null) ?? null,
    expiresAt: s.expiresAt.toISOString(),
  };
}

/** Граница журнала подключений: завершённые сессии старше не показываются (и удаляются, AR-194). */
export const journalSince = (now: Date): Date =>
  new Date(now.getTime() - ACCESS_PARAMS.sessionJournalDays * 24 * 3600 * 1000);
