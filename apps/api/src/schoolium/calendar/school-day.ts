/**
 * ЕДИНСТВЕННЫЙ владелец понятия «сегодня» в учебном смысле (AR-100, AR-117).
 *
 * «Сегодня» в этой версии решает три вопроса и ни одного больше: с какого дня
 * материализуется горизонт, какая колонка журнала будущая (`future`) и идут ли
 * каникулы. Раньше на этот вопрос отвечали четыре независимых `new Date()` в
 * трёх файлах — и разойтись они могли молча.
 *
 * `SCHOOL_TODAY=YYYY-MM-DD` фиксирует учебный день так же, как `GEN_SEED`
 * фиксирует зерно генератора (AR-97): без него ни смок, ни жалоба «журнал
 * пустой» не воспроизводятся — поведение зависит от того, какое сегодня число.
 * Правила флага:
 *
 *   · он сдвигает ТОЛЬКО учебный день. Сроки токенов, кодов входа и сессий
 *     живут по настоящим часам (`new Date()` на месте) — иначе флаг отладки
 *     продлевал бы доступ, а это уже не отладка;
 *   · значение, которое не разбирается как календарная дата, ИГНОРИРУЕТСЯ и
 *     печатается один раз: опечатка в env не должна тихо переносить школу
 *     в другой год (то же правило fail-closed, что у `AUTH_MODE`, AR-94).
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

let warned = false;

/** Учебный день как `Date` в полночь UTC — все сравнения дат идут через него. */
export function schoolToday(): Date {
  const raw = process.env.SCHOOL_TODAY;
  if (raw) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (ISO_DAY.test(raw) && !Number.isNaN(d.getTime())) return d;
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn(`SCHOOL_TODAY=${raw} не разбирается как YYYY-MM-DD — учебный день берётся из системных часов`);
    }
  }
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Учебный день строкой `YYYY-MM-DD` — форма, в которой его сравнивает журнал. */
export const schoolTodayIso = (): string => schoolToday().toISOString().slice(0, 10);

const HH_MM = /^\d{1,2}:\d{2}$/;
let warnedNow = false;

/**
 * «Сейчас» учебного дня в минутах от полуночи по часовому поясу школы
 * (AR-172, минутный гейт журнала). `SCHOOL_NOW=HH:MM` фиксирует его для
 * проверок тем же правилом, что `SCHOOL_TODAY`: сдвигает ТОЛЬКО учебное
 * время, сроки токенов и сессий живут по настоящим часам; неразбираемое
 * значение игнорируется с одним предупреждением (fail-closed, AR-94).
 */
export function schoolNowMinutes(timezone: string): number {
  const raw = process.env.SCHOOL_NOW;
  if (raw) {
    if (HH_MM.test(raw)) {
      const [h, m] = raw.split(':').map(Number);
      if (h < 24 && m < 60) return h * 60 + m;
    }
    if (!warnedNow) {
      warnedNow = true;
      // eslint-disable-next-line no-console
      console.warn(`SCHOOL_NOW=${raw} не разбирается как HH:MM — учебное «сейчас» берётся из системных часов`);
    }
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date());
  }
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}
