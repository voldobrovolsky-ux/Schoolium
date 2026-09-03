import type { Request } from 'express';

/**
 * Публичный origin школы для ссылок, которые уходят человеку наружу (ссылка
 * входа AR-189, постоянный адрес карточки). `WEB_ORIGIN` — источник истины
 * прода (`docker-compose.prod.yml`); хост запроса — фолбэк стенда без него:
 * за прокси он внутренний, и ссылка с ним не откроется с телефона.
 */
export function webOrigin(req: Request): string {
  const env = process.env.WEB_ORIGIN?.trim();
  if (env) return env.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}
