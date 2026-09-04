/**
 * Общий вид расписания и дневника (AR-175, УТЦ v1.4 фаза II): ОДИН код рендерит
 * день по скелету (AR-171) с фолбэком на арифметику `slotTimes`; дневник
 * добавляет отметку после названия предмета тем же компонентом, не копией.
 *
 * Правила владельца 2026-08-30/31:
 *   · мобайл — ПИКЕР дня: неподвижный слот, лента дней учебного календаря едет
 *     под ним со снапом; дата ТОЛЬКО под открытым днём;
 *   · десктоп — лента недель, вся неделя двумя колонками по три дня
 *     (ПН/ВТ/СР слева, ЧТ/ПТ/СБ справа);
 *   · строка урока: «N. Предмет (1|2)» + «HH:MM — HH:MM»; N — позиция в общей
 *     нумерации дня, (1|2) — часть пары; обед и события скелета — строками
 *     в той же нумерации; перемены — разрывами между позициями.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { slotTimes, type DayGridDto, type MarkValue, type SkeletonPositionDto } from "@edustore/shared";
import { MarkChip } from "./ui";

export const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const fmtMin = (m: number): string => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
export const dayMonth = (isoDay: string): string => `${Number(isoDay.slice(8))} ${MONTHS[Number(isoDay.slice(5, 7)) - 1]}`;

/** «1 — 5 сентября» либо «29 сентября — 3 октября» — индикатор недели. */
export const weekRange = (from: string, to: string): string =>
  from.slice(5, 7) === to.slice(5, 7) ? `${Number(from.slice(8))} — ${dayMonth(to)}` : `${dayMonth(from)} — ${dayMonth(to)}`;

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const mondayOf = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};

/** Плавная подкрутка лент — но не для тех, кто просил обходиться без анимаций. */
const scrollBehavior = (): ScrollBehavior =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

// ─────────────────────────── модель дня ───────────────────────────

/** Маркер строки урока (AR-207): отменён без замены либо ведёт заместитель. */
export interface DayCellStatus {
  kind: "cancelled" | "substituted";
  /** Слово рядом с цветом (AR-80): «Отменён» / «Замена: Фамилия И.». */
  label: string;
}

export interface DayCell {
  key: string;
  title: string;
  sub?: string | null;
  mark?: MarkValue | null;
  /** AR-207: маркер отмены/замены; нет — обычный урок. */
  status?: DayCellStatus | null;
  /**
   * Действия строки (AR-206/207): кнопки собирает экран-владелец (там живут
   * его testId и права), здесь — только место под ними внутри ячейки.
   */
  actions?: ReactNode;
  /** Датированный урок за ячейкой — адрес строки для прокрутки и смока. */
  lessonId?: string | null;
}

export interface LessonRow {
  type: "lesson";
  posNo: number;
  lessonNo: number;
  pairLabel: string | null;
  start: string;
  end: string;
  cells: DayCell[];
  breakAfterMin: number | null;
}

export interface SpecialRow {
  type: "special";
  posNo: number;
  title: string;
  start: string;
  end: string;
}

export type DayRow = LessonRow | SpecialRow;

/**
 * День как список строк: по скелету — позиции в общей нумерации (уроки, обед,
 * события) с явными временами и частями пар; без скелета — прежний фолбэк на
 * `slotTimes`. Урочная позиция без содержимого у этого класса — «окно», строка
 * не рендерится; спец-позиции (обед, линейка) видны в учебный день. День, где
 * уроков нет вовсе, пуст целиком — «Занятий нет», а не обед без уроков.
 */
export function buildDayRows(opts: {
  skeleton: SkeletonPositionDto[] | null | undefined;
  grid: DayGridDto | null | undefined;
  dayNo: number;
  cellsByLesson: Map<number, DayCell[]>;
  /**
   * AR-200: обед класса после урока N — строка «Обед» встаёт в урочную позицию
   * N+1 (класс в ней урока не имеет), общие позиции `meal` скелета для такого
   * класса не показываются. `null`/нет — как у школы. Вид преподавателя и
   * журнал значение не передают.
   */
  lunchAfterLessonNo?: number | null;
}): DayRow[] {
  const { skeleton, grid, dayNo, cellsByLesson } = opts;
  const lunchAfter = opts.lunchAfterLessonNo ?? null;
  const rows: DayRow[] = [];
  const positions = (skeleton ?? [])
    .filter((p) => p.dayNo === dayNo)
    // обед класса заменяет общий обед школы (AR-200)
    .filter((p) => lunchAfter === null || p.kind !== "meal")
    .sort((a, b) => a.posNo - b.posNo);
  if (positions.length) {
    // урочная позиция N+1 у класса с собственным обедом — его «Обед»; если
    // данные всё же несут там урок, урок сильнее строки-подстановки
    const isLunchPos = (p: SkeletonPositionDto): boolean =>
      lunchAfter !== null &&
      p.kind === "lesson" &&
      p.lessonNo === lunchAfter + 1 &&
      (cellsByLesson.get(p.lessonNo ?? -1)?.length ?? 0) === 0;
    const visible = positions.filter(
      (p) => p.kind !== "lesson" || isLunchPos(p) || (cellsByLesson.get(p.lessonNo ?? -1)?.length ?? 0) > 0,
    );
    // «(1|2)» — метка ЧАСТИ ПАРЫ предмета, а не половины времени: ставится
    // только когда обе половины pairNo видимы и несут ОДИН предмет (AR-171).
    // Одиночный час, попавший в парное время, меткой не врёт.
    const contentOf = (p: SkeletonPositionDto): string =>
      (cellsByLesson.get(p.lessonNo ?? -1) ?? []).map((c) => c.title).sort().join("|");
    const labeledPairs = new Set<number>();
    for (const no of new Set(visible.filter((p) => p.kind === "lesson" && p.pairNo).map((p) => p.pairNo!))) {
      const halves = visible.filter((p) => p.kind === "lesson" && p.pairNo === no);
      if (halves.length >= 2 && halves.every((p) => contentOf(p) === contentOf(halves[0]))) labeledPairs.add(no);
    }
    const pairSeen = new Map<number, number>();
    visible.forEach((p, i) => {
      const nxt = visible[i + 1];
      const gap = nxt ? nxt.startMin - p.endMin : 0;
      if (isLunchPos(p)) {
        rows.push({ type: "special", posNo: p.posNo, title: "Обед", start: fmtMin(p.startMin), end: fmtMin(p.endMin) });
      } else if (p.kind === "lesson") {
        let pairLabel: string | null = null;
        if (p.pairNo && labeledPairs.has(p.pairNo)) {
          const part = (pairSeen.get(p.pairNo) ?? 0) + 1;
          pairSeen.set(p.pairNo, part);
          pairLabel = String(part);
        }
        rows.push({
          type: "lesson",
          posNo: p.posNo,
          lessonNo: p.lessonNo ?? 0,
          pairLabel,
          start: fmtMin(p.startMin),
          end: fmtMin(p.endMin),
          cells: cellsByLesson.get(p.lessonNo ?? -1) ?? [],
          breakAfterMin: nxt && gap > 0 ? gap : null,
        });
      } else {
        rows.push({ type: "special", posNo: p.posNo, title: p.title ?? "—", start: fmtMin(p.startMin), end: fmtMin(p.endMin) });
      }
    });
    return rows.some((r) => r.type === "lesson") ? rows : [];
  }
  const lessonNos = [...cellsByLesson.keys()].filter((no) => (cellsByLesson.get(no)?.length ?? 0) > 0).sort((a, b) => a - b);
  // Фолбэк без скелета: обед класса (AR-200) — строка в слоте N+1, когда день
  // идёт и до него, и после (обед после последнего урока — не часть дня).
  const lunchSlot =
    lunchAfter !== null && lessonNos.some((no) => no <= lunchAfter) && lessonNos.some((no) => no >= lunchAfter + 2)
      ? lunchAfter + 1
      : null;
  lessonNos.forEach((no, i) => {
    const cells = cellsByLesson.get(no) ?? [];
    const t = grid ? slotTimes(grid, no) : null;
    const next = lessonNos[i + 1];
    rows.push({
      type: "lesson",
      posNo: no,
      lessonNo: no,
      pairLabel: null,
      start: t?.start ?? "",
      end: t?.end ?? "",
      cells,
      breakAfterMin: t && next !== undefined ? (next === no + 1 ? t.breakAfterMin : null) : null,
    });
    if (lunchSlot !== null && no === lunchAfter) {
      const lt = grid ? slotTimes(grid, lunchSlot) : null;
      rows.push({ type: "special", posNo: lunchSlot, title: "Обед", start: lt?.start ?? "", end: lt?.end ?? "" });
    }
  });
  return rows;
}

/** «Фамилия И.» из полного имени (AR-207, формат маркера «Замена: Фамилия И.»). */
export const teacherShort = (full: string | null | undefined): string => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0]}.`;
};

/** «Фамилия И. О.» — форма результата подбора замены («Замена: Иванова М. И.»). */
export const teacherInitials = (full: string | null | undefined): string => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return [parts[0], ...parts.slice(1, 3).map((p) => `${p[0]}.`)].join(" ");
};

// ─────────────────────────── список дня ───────────────────────────

export function DayLessonList({
  rows,
  testId,
  pairedTestId,
  cancelledTestId,
  substitutedTestId,
}: {
  rows: DayRow[];
  testId?: string;
  pairedTestId?: string;
  /** Идентификаторы маркеров отмены/замены (AR-207) — из реестра экрана-владельца. */
  cancelledTestId?: string;
  substitutedTestId?: string;
}) {
  if (!rows.length) {
    // «день помечен, не пуст» (20-cabinets §4, FLOR-ADS §5.21)
    return (
      <p className="sch-muted sch-noday" data-testid={testId}>
        Занятий нет
      </p>
    );
  }
  return (
    <div className="sch-stack sch-unfold" data-testid={testId}>
      {rows.map((r, i) =>
        r.type === "special" ? (
          <div key={`s${r.posNo}`} className="sch-lesson sch-lesson--special">
            <div className="sch-pos-no">{r.posNo}.</div>
            <div className="sch-lesson-body">
              <span className="sch-lesson-title">
                <b>{r.title}</b>
                <span className="sch-lesson-when">
                  ({r.start} — {r.end})
                </span>
              </span>
            </div>
          </div>
        ) : (
          <div key={`l${r.posNo}`} className="sch-stack" style={{ gap: 0 }}>
            <div
              className="sch-lesson"
              data-testid={pairedTestId && r.cells.length > 1 ? pairedTestId : undefined}
            >
              <div className="sch-pos-no">{r.posNo}.</div>
              <div className="sch-lesson-body">
                {r.cells.map((c) => (
                  <span className="sch-slot" key={c.key} data-lesson-id={c.lessonId ?? undefined}>
                    <span className="sch-lesson-title">
                      <b>
                        {c.title}
                        {r.pairLabel ? ` (${r.pairLabel})` : ""}
                      </b>
                      {c.mark ? <MarkChip value={c.mark} /> : null}
                    </span>
                    {r.start ? (
                      <span className="sch-lesson-when">
                        {r.start} — {r.end}
                      </span>
                    ) : null}
                    {c.sub ? <span>{c.sub}</span> : null}
                    {/* AR-207: маркер — слово рядом с цветом (AR-80), не только цвет */}
                    {c.status ? (
                      <span
                        className="sch-sched-status"
                        data-status={c.status.kind}
                        data-testid={c.status.kind === "cancelled" ? cancelledTestId : substitutedTestId}
                      >
                        {c.status.label}
                      </span>
                    ) : null}
                    {c.actions ? <span className="sch-sched-actions">{c.actions}</span> : null}
                  </span>
                ))}
              </div>
            </div>
            {r.breakAfterMin != null && i < rows.length - 1 ? (
              <div className="sch-break">перемена {r.breakAfterMin} мин</div>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

// ─────────────────────────── ленты ───────────────────────────

/** День сквозной ленты пикера: дата определяет и день недели, и содержимое. */
export interface PickerDay {
  date: string;
  dayNo: number;
  muted?: boolean;
}

export const dayNoOf = (iso: string): number => (new Date(`${iso}T00:00:00.000Z`).getUTCDay() + 6) % 7;

/**
 * Учебные дни (ПН…СБ) внутри четвертей календаря — сквозная лента для пикера:
 * день до начала и после конца четверти в ленту не попадает и уроков не несёт
 * (правка владельца 2026-08-31: 31 августа — не учебный день). Календарь не
 * прочитался — одна текущая неделя, экран живёт.
 */
export function calendarDays(
  terms: { dateFrom: string | null; dateTo: string | null }[],
  todayIso: string,
): PickerDay[] {
  const filled = terms
    .filter((t): t is { dateFrom: string; dateTo: string } => Boolean(t.dateFrom && t.dateTo))
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  if (!filled.length) {
    const mon = mondayOf(todayIso);
    return [0, 1, 2, 3, 4, 5].map((d) => ({ date: addDays(mon, d), dayNo: d }));
  }
  const out: PickerDay[] = [];
  for (const t of filled) {
    // предохранитель длины — учебный год ≈ 210 учебных дней
    for (let d = t.dateFrom; d <= t.dateTo && out.length < 400; d = addDays(d, 1)) {
      const dn = dayNoOf(d);
      if (dn < 6) out.push({ date: d, dayNo: dn });
    }
  }
  return out;
}

/** Дата внутри хотя бы одной четверти; календарь пуст — не судим. */
export function inTerms(date: string, terms: { dateFrom: string | null; dateTo: string | null }[]): boolean {
  const filled = terms.filter((t) => t.dateFrom && t.dateTo);
  if (!filled.length) return true;
  return filled.some((t) => t.dateFrom! <= date && date <= t.dateTo!);
}

/**
 * Мобильный пикер дня (правка владельца 2026-08-31): СЛОТ выбранного дня
 * неподвижен — второе место ленты, — а лента дней учебного календаря едет под
 * ним со снапом; день, вставший в слот, и есть открытый. Дни сквозные по
 * календарю, а не «7 текущей недели»; дата — только под открытым днём
 * (правка 2026-08-30 действует).
 */
export function DayPicker({
  days,
  open,
  onOpen,
  testId,
}: {
  days: PickerDay[];
  open: string;
  onOpen: (date: string) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Шаг ленты читается с DOM: ширину чипа задаёт CSS, дублировать её числом
  // в коде значило бы завести второй источник (П-5).
  const step = (): number => {
    const a = ref.current?.children[0] as HTMLElement | undefined;
    const b = ref.current?.children[1] as HTMLElement | undefined;
    return a && b ? b.offsetLeft - a.offsetLeft || 60 : 60;
  };
  const daysKey = days.length ? `${days[0].date}·${days[days.length - 1].date}·${days.length}` : "";

  // Программное позиционирование ВСЕГДА мгновенное: плавную подкрутку browser
  // прерывает чем угодно (ресайз, подмена ленты, снап после layout) и лента
  // замирает на чужом дне — найдено мобильным смоком. Плавность остаётся у
  // нативного свайпа; тап отвечает мгновенным прыжком в слот.
  useEffect(() => {
    const i = days.findIndex((d) => d.date === open);
    if (i < 0) return;
    clearTimeout(settle.current); // таймер, взведённый до перестановки, судил бы старую ленту
    ref.current?.scrollTo({ left: i * step(), behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, daysKey]);
  useEffect(() => () => clearTimeout(settle.current), []);

  const onScroll = () => {
    clearTimeout(settle.current);
    // лента остановилась — открыт день, вставший в слот
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el || !days.length) return;
      const i = Math.min(days.length - 1, Math.max(0, Math.round(el.scrollLeft / step())));
      if (days[i].date !== open) onOpen(days[i].date);
    }, 140);
  };

  return (
    <div className="sch-daypicker" data-testid={testId}>
      <div className="sch-daypicker-strip" ref={ref} onScroll={onScroll}>
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            data-date={d.date}
            aria-pressed={d.date === open}
            className={
              "sch-daychip" +
              (d.date === open ? " sch-daychip--active" : "") +
              (d.muted ? " sch-daychip--muted" : "")
            }
            onClick={() => onOpen(d.date)}
          >
            <small>{DAY_NAMES[d.dayNo]}</small>
            {d.date === open ? <span className="sch-daychip-date">{Number(d.date.slice(8))}</span> : null}
          </button>
        ))}
      </div>
      <span className="sch-daypicker-slot" aria-hidden="true" />
    </div>
  );
}

/** Десктопная лента недель — мотается курсором, открытая подкручивается в центр. */
export function WeekStrip({
  weeks,
  open,
  onOpen,
  testId,
}: {
  weeks: { monday: string; label: string; muted?: boolean }[];
  open: string;
  onOpen: (monday: string) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[data-open="1"]')
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: scrollBehavior() });
  }, [open]);
  return (
    <div className="sch-weekstrip" ref={ref} data-testid={testId}>
      {weeks.map((w) => (
        <button
          key={w.monday}
          type="button"
          data-monday={w.monday}
          data-open={w.monday === open ? "1" : undefined}
          className={
            "sch-weekchip" +
            (w.monday === open ? " sch-weekchip--active" : "") +
            (w.muted ? " sch-weekchip--muted" : "")
          }
          onClick={() => onOpen(w.monday)}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

/** Раскладка недели 3+3: ПН/ВТ/СР слева, ЧТ/ПТ/СБ справа (AR-175). */
export function Days33({
  dayNos,
  header,
  render,
  testId,
}: {
  dayNos: number[];
  header: (dayNo: number) => ReactNode;
  render: (dayNo: number) => ReactNode;
  testId?: string;
}) {
  return (
    <div className="sch-days33" data-testid={testId}>
      {dayNos.map((d) => (
        <section key={d} className="sch-day33">
          <header className="sch-day33-head">{header(d)}</header>
          {render(d)}
        </section>
      ))}
    </div>
  );
}
