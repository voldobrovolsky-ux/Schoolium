/**
 * G-50 (AR-108, AR-24, AR-45) — **события полны по подписчику.**
 *
 * У каждого из 22 событий версии названы издатель, подписчик и реакция. «Нет
 * подписчика (только аудит)» — законное значение; ПУСТАЯ КЛЕТКА — падение.
 * Сверка идёт в обе стороны: реестр в коде против таблицы `30-spec.md`, и
 * каждая названная подписка обязана существовать в шине — иначе связь
 * молчаливая, выведенная исполнителем из соседнего раздела.
 *
 * Отдельно доказывается то, ради чего решение принималось: удаление ученика
 * издаёт своё событие и журнал снимает строку ПОДПИСКОЙ, а не чтением таблиц
 * контингента; расписание уходит в `stale` подпиской на деактивацию сотрудника,
 * снятие привязки и удаление предмета.
 *
 * Запуск: npm --workspace apps/api run subscribers:check
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../src/common/events/event-bus';
import { EVENT_CONTRACT, SCHOOL_EVENTS, STALE_ON_EVENTS } from '../src/schoolium/schoolium.contract';
import { bench, check, report } from './schoolium/harness';

/** Таблица контрактов из `30-spec.md`: событие → издатель, подписчик, реакция. */
function specTable(): { type: string; publisher: string; subscriber: string; reaction: string }[] {
  const src = readFileSync(join(__dirname, '../../../specs/school-onboarding/30-spec.md'), 'utf8');
  const start = src.indexOf('| Событие | Издатель |');
  const end = src.indexOf('Владение полями:', start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => l.startsWith('|') && /\.v\d/.test(l))
    // Разделитель — «|», НЕ экранированный обратной косой: payload событий
    // перечисляет варианты через «\|», и наивный split ломает разметку колонок.
    .map((l) => l.split(/(?<!\\)\|/).map((c) => c.trim()))
    .map((c) => ({ type: c[1], publisher: c[2], subscriber: c[4], reaction: c[5] }));
}

async function main(): Promise<void> {
  const b = await bench();
  console.log('G-50 · у каждого события назван подписчик и реакция (AR-108)\n');

  const spec = specTable();
  check(spec.length === 22, `в таблице контрактов ${spec.length} событий (версия обещает 22)`);
  check(EVENT_CONTRACT.length === 22, `в исполняемом реестре ${EVENT_CONTRACT.length} событий`);

  // ─── ни одной пустой клетки ───
  const emptyCells = spec.filter((r) => !r.publisher || !r.subscriber || !r.reaction);
  check(emptyCells.length === 0, emptyCells.length === 0
    ? 'ни одной пустой клетки: у каждого события назван издатель, подписчик и реакция'
    : `пустые клетки у: ${emptyCells.map((r) => r.type).join(', ')}`);

  // ─── документ и код сходятся в обе стороны ───
  const inCode = new Set<string>(EVENT_CONTRACT.map((r) => r.type));
  const inSpec = new Set<string>(spec.map((r) => r.type));
  const onlySpec = [...inSpec].filter((t) => !inCode.has(t));
  const onlyCode = [...inCode].filter((t) => !inSpec.has(t));
  check(onlySpec.length === 0, onlySpec.length === 0 ? 'каждое событие спеки реализовано' : `в коде нет: ${onlySpec.join(', ')}`);
  check(onlyCode.length === 0, onlyCode.length === 0 ? 'каждое событие кода описано в спеке' : `в спеке нет: ${onlyCode.join(', ')}`);

  // ─── «нет подписчика» — законное значение, но объявленное ЯВНО ───
  for (const r of EVENT_CONTRACT) {
    const doc = spec.find((x) => x.type === r.type);
    const docSaysNone = /нет подписчика/.test(doc?.subscriber ?? '');
    const codeSaysNone = r.subscribers.length === 0;
    check(docSaysNone === codeSaysNone,
      `${r.type}: ${codeSaysNone ? '«нет подписчика (только аудит)» — объявлено явно' : `подписчики ${r.subscribers.join(', ')}`}`);
    check(r.reaction.length > 0, `${r.type}: реакция названа`);
  }

  // ─── названная подписка существует в шине ───
  const bus = b.app.get(EventBus) as unknown as { subs: { pattern: string; consumer: string }[] };
  const registered = new Map<string, Set<string>>();
  for (const s of bus.subs) {
    if (!registered.has(s.pattern)) registered.set(s.pattern, new Set());
    registered.get(s.pattern)!.add(s.consumer);
  }
  for (const r of EVENT_CONTRACT) {
    const consumers = registered.get(r.type) ?? new Set<string>();
    if (r.subscribers.length === 0) {
      check(consumers.has('audit'),
        `${r.type}: подписчика нет, но аудит слушает — «только аудит» это тоже значение, а не пустота`);
      continue;
    }
    const missing = r.subscribers.filter((s) => s !== 'access' && !consumers.has(s));
    check(missing.length === 0, missing.length === 0
      ? `${r.type}: подписки живут в шине (${[...consumers].join(', ')})`
      : `${r.type}: названы подписчики ${missing.join(', ')}, но в шине их нет — связь молчаливая`);
  }

  // ─── то, ради чего решение принималось ───
  check(inCode.has(SCHOOL_EVENTS.studentDeleted),
    'у удаления ученика ЕСТЬ своё событие — иначе строка удалённого висит в журнале навсегда либо журнал лезет в чужую схему (AR-108)');
  check((registered.get(SCHOOL_EVENTS.studentDeleted) ?? new Set()).has('journal'),
    'журнал подписан на удаление ученика — строку снимает подпиской, а не сверкой таблиц');
  for (const t of [SCHOOL_EVENTS.staffDeactivated, SCHOOL_EVENTS.teacherUnbound, SCHOOL_EVENTS.subjectDeleted]) {
    check((registered.get(t) ?? new Set()).has('schedule'),
      `расписание подписано на ${t} — таблица «что делает сетку устаревшей» требует этой связи`);
  }
  check(STALE_ON_EVENTS.length === 8,
    `событий, роняющих сетку в stale, восемь: ${STALE_ON_EVENTS.length} — перечислением, а не догадкой`);

  // ─── каждый подписчик проходит через inbox (AR-24) ───
  const busSrc = readFileSync(join(__dirname, '../src/common/events/in-process-event-bus.ts'), 'utf8');
  check(/processedEvent/.test(busSrc),
    'дедуп подписчиков навешен ЦЕНТРАЛЬНО в шине — правило «каждый подписчик через inbox» невозможно забыть (AR-24)');

  await b.close();
  report('G-50 · СОБЫТИЯ ПОЛНЫ ПО ПОДПИСЧИКУ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
