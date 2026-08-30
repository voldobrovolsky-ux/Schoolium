/**
 * Общий вид расписания и дневника (AR-175, УТЦ v1.4 фаза II): ОДИН код рендерит
 * день по скелету (AR-171) с фолбэком на арифметику `slotTimes`; дневник
 * добавляет отметку после названия предмета тем же компонентом, не копией.
 *
 * Правила владельца 2026-08-30:
 *   · мобайл — лента дней, дата ТОЛЬКО под открытым днём, листание со снапом;
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

export interface DayCell {
  key: string;
  title: string;
  sub?: string | null;
  mark?: MarkValue | null;
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
}): DayRow[] {
  const { skeleton, grid, dayNo, cellsByLesson } = opts;
  const rows: DayRow[] = [];
  const positions = (skeleton ?? []).filter((p) => p.dayNo === dayNo).sort((a, b) => a.posNo - b.posNo);
  if (positions.length) {
    const visible = positions.filter(
      (p) => p.kind !== "lesson" || (cellsByLesson.get(p.lessonNo ?? -1)?.length ?? 0) > 0,
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
      if (p.kind === "lesson") {
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
  const lessonNos = [...cellsByLesson.keys()].sort((a, b) => a - b);
  lessonNos.forEach((no, i) => {
    const cells = cellsByLesson.get(no) ?? [];
    if (!cells.length) return;
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
  });
  return rows;
}

// ─────────────────────────── список дня ───────────────────────────

export function DayLessonList({
  rows,
  testId,
  pairedTestId,
}: {
  rows: DayRow[];
  testId?: string;
  pairedTestId?: string;
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
                  <span className="sch-slot" key={c.key}>
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

/** Мобильная лента дней: дата — ТОЛЬКО под открытым днём; снап и автоподкрутка. */
export function DayStrip({
  days,
  open,
  onOpen,
  testId,
}: {
  days: { dayNo: number; label: string; date?: string | null; muted?: boolean }[];
  open: number;
  onOpen: (dayNo: number) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[data-open="1"]')
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: scrollBehavior() });
  }, [open]);
  return (
    <div className="sch-daystrip sch-daystrip--snap" ref={ref} data-testid={testId}>
      {days.map((d) => (
        <button
          key={d.dayNo}
          type="button"
          data-open={d.dayNo === open ? "1" : undefined}
          className={
            "sch-daychip" +
            (d.dayNo === open ? " sch-daychip--active" : "") +
            (d.muted ? " sch-daychip--muted" : "")
          }
          onClick={() => onOpen(d.dayNo)}
        >
          <small>{d.label}</small>
          {d.dayNo === open && d.date ? <span className="sch-daychip-date">{Number(d.date.slice(8))}</span> : null}
        </button>
      ))}
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
