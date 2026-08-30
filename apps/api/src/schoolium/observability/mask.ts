/**
 * Маскирование персональных данных (AR-30, AR-97).
 *
 * **Инвариант поверх любых флагов: маскирование не отключается.** Ни `LOG_LEVEL`,
 * ни `DEBUG_HTTP`, ни `DEBUG_SQL` его не снимают — ФИО и телефоны не попадают в
 * plaintext-логи ни в одном режиме. Флаг отладки, который «на минутку» открывает
 * ПДн, — это тот самый флаг, который останется включённым.
 */

/** Поля, значения которых в логах не показываются никогда. */
export const PII_FIELDS = [
  'phone',
  'lastName',
  'firstName',
  'middleName',
  'displayName',
  'name',
  'teacherName',
  'scannedByName',
  'registeredName',
  'lastEditorName',
  'code',
  'token',
  'sessionToken',
  'avatarUrl',
] as const;

const MASK = '···';

/** Телефон: видны только последние две цифры — по ним человек узнаёт свой номер. */
export function maskPhone(v: string): string {
  const digits = v.replace(/\D/g, '');
  return digits.length > 2 ? `${MASK}${digits.slice(-2)}` : MASK;
}

/** ФИО: только первая буква — достаточно, чтобы отличить строки, мало, чтобы узнать. */
export function maskName(v: string): string {
  return v ? `${v[0]}${MASK}` : MASK;
}

/**
 * Рекурсивно маскирует ПДн в произвольной структуре перед выводом в лог.
 * Идентификаторы (`userId`, `studentId`, `lessonId`) остаются: по ним читается
 * трасса, и они не являются персональными данными сами по себе (AR-25).
 */
export function maskPII(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => maskPII(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && (PII_FIELDS as readonly string[]).includes(k)) {
      out[k] = k === 'phone' ? maskPhone(v) : k === 'token' || k === 'sessionToken' || k === 'code' ? MASK : maskName(v);
    } else {
      out[k] = maskPII(v, depth + 1);
    }
  }
  return out;
}

/** Именованные флаги отладки (AR-97). Значение читается один раз, при старте. */
export const DEBUG_FLAGS = {
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'info' | 'debug',
  sql: process.env.DEBUG_SQL === '1',
  events: process.env.DEBUG_EVENTS === '1',
  http: process.env.DEBUG_HTTP === '1',
  genSeed: process.env.GEN_SEED ? Number(process.env.GEN_SEED) : null,
} as const;
