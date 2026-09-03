/**
 * Адрес клиента из `X-Forwarded-For` (AR-187) — ЧИСТАЯ функция, доказанная
 * перечислением в `admin-cabinet-check.ts`.
 *
 * Заголовок — список через запятую, и каждый прокси на пути ДОПИСЫВАЕТ адрес
 * того, от кого получил запрос (`proxy_add_x_forwarded_for` в nginx). Значит
 * первый элемент контролирует сам клиент: кто угодно пришлёт
 * `X-Forwarded-For: 8.8.8.8`, и карта устройств покажет «новую сеть» из
 * выдумки. Достоверен только хвост: адрес отсчитывается С КОНЦА, отступив
 * столько доверенных хопов, сколько прокси стоят перед API.
 *
 *   · Caddy + web-nginx (прод, `docker-compose.prod.yml`) — 2;
 *   · host-nginx + web-nginx (`deploy/nginx/edustore.conf`) — 2;
 *   · один web-nginx на голом IP (демо, вариант В) — 1.
 *
 * Число хопов — `TRUSTED_PROXY_HOPS` из окружения (`.env.prod.example`).
 * Хопов больше, чем элементов в заголовке, — берётся первый элемент (все
 * известные прокси доверены); заголовка нет либо хопов ноль — адрес сокета.
 */
export const DEFAULT_TRUSTED_PROXY_HOPS = 2;

export function trustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TRUSTED_PROXY_HOPS;
}

export function clientIp(
  xffHeader: string | string[] | undefined,
  socketAddr: string | null | undefined,
  hops: number = trustedProxyHops(),
): string | null {
  const raw = Array.isArray(xffHeader) ? xffHeader.join(',') : (xffHeader ?? '');
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const socket = socketAddr || null;
  if (parts.length === 0 || hops <= 0) return socket;
  const picked = parts[Math.max(0, parts.length - hops)];
  return picked || socket;
}
