/**
 * Журнал: `S-50` таблица, `S-51` поповер темы урока, `S-52` выбор отметки.
 *
 * Таблица производна (AR-83): колонки — материализованные уроки, строки —
 * ученики; и то, и другое приезжает событиями, журнал ничего не сочиняет.
 *
 * Гейты живут в контракте, интерфейс их ОТРАЖАЕТ, а не заменяет (красная
 * линия 3): серая колонка будущего урока — это отражение `LESSON_NOT_HELD`,
 * и попытка обойти интерфейс упирается в тот же отказ на сервере.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClassDto, JournalColumnDto, JournalRowDto, JournalWeekDto, MarkValue, SubjectDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile } from "../hooks";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  MARK_ORDER,
  MarkChip,
  PopoverOrSheet,
  Skeletons,
  Toast,
  markKey,
  useToast,
} from "../ui";
import { useSession } from "../session";
import { navigate } from "../router";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** «2026-09-04» → «4.09»: шапка колонки короткая, месяц двумя цифрами. */
const shortDate = (iso: string): string => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;
/** «2026-09-04» → «4 сентября»: подпись `S-51.meta` человеческая. */
const longDate = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

const fio = (r: JournalRowDto): string => [r.lastName, r.firstName, r.middleName].filter(Boolean).join(" ");
/**
 * «Иванов И.» — ФИО в закреплённой колонке мобильного журнала (§6). Полное имя
 * на 390px съедало бы половину ширины, и колонок дат не осталось бы вовсе;
 * фамилии с инициалом хватает, чтобы найти строку глазами, а полное имя
 * называет слой отметки, который открывается тапом по ячейке.
 */
const fioShort = (r: JournalRowDto): string =>
  r.firstName ? `${r.lastName} ${r.firstName[0]}.` : r.lastName;

/** Тексты отказов §9 — те же слова, что отдаёт сервер: расхождения быть не должно. */
const LESSON_NOT_HELD = "Урок ещё не прошёл";
const LESSON_DETACHED = "Урок вне расписания: отметки сохранены, изменить их нельзя";
const STUDENT_INACTIVE = "Ученик деактивирован";

export function JournalScreen({ classId, subjectId }: { classId: string | null; subjectId: string | null }) {
  const me = useSession();
  const userId = me.state.status === "authed" ? me.state.me.userId : "";
  const [refs, reloadRefs] = useAsync(async () => {
    const [classes, subjects] = await Promise.all([api.classes(), api.subjects()]);
    return { classes: classes.classes, subjects };
  });

  if (refs.status === "loading") return <Skeletons count={6} kind="row" />;
  if (refs.status === "error") return <ErrorState message={refs.message} onRetry={reloadRefs} />;

  const { classes, subjects } = refs.data;
  if (classes.length === 0 || subjects.length === 0) {
    // Ни классов, ни предметов — уроков не будет по построению: это тот же
    // «сетка не подтверждена», только раньше по времени.
    return (
      <EmptyState
        testId="S-50.empty"
        title="Уроки появятся после подтверждения расписания"
        hint="Сначала классы и предметы, затем расписание"
        action={
          <Button kind="primary" onClick={() => navigate("/schedule")}>
            К расписанию
          </Button>
        }
      />
    );
  }

  /*
   * Журнал открывается на СВОЁМ, а не на первом классе школы.
   *
   * До этого стояло `classes[0]`, и педагог, ведущий 5А и 5Б, попадал в «1А» —
   * класс, где у него ничего нет, — и читал «Уроки появятся после
   * подтверждения расписания. У класса нет предметов — заведите их»: совет,
   * который к нему не относится и которого он не имеет права выполнить.
   * Расписание при этом было подтверждено, а его уроки существовали.
   *
   * Порядок предпочтений: явный выбор из адреса → класс, где у человека есть
   * привязка → первый класс, где вообще есть предметы → первый класс школы.
   * Последние два — для модератора и завуча, у которых привязок нет по роли.
   */
  const mine = subjects.filter((s) => s.bindings.some((b) => b.teacherId === userId));
  const withSubjects = classes.filter((c) => subjects.some((s) => s.classId === c.id));
  const cls =
    classes.find((c) => c.id === classId) ??
    classes.find((c) => mine.some((s) => s.classId === c.id)) ??
    withSubjects[0] ??
    classes[0];
  const forClass = subjects.filter((s) => s.classId === cls.id);
  // Внутри класса — тот же порядок: свой предмет вперёд чужого.
  const subj =
    forClass.find((s) => s.id === subjectId) ??
    forClass.find((s) => mine.some((m) => m.id === s.id)) ??
    forClass[0] ??
    null;

  return <JournalBody key={`${cls.id}:${subj?.id ?? "-"}`} classes={classes} cls={cls} forClass={forClass} subj={subj} />;
}

function JournalBody({
  classes,
  cls,
  forClass,
  subj,
}: {
  classes: ClassDto[];
  cls: ClassDto;
  forClass: SubjectDto[];
  subj: SubjectDto | null;
}) {
  /* Неделю выбирает человек, но НАЧАЛЬНУЮ выбирает сервер: он один знает
     календарь и то, идёт ли сейчас учебный год. Пока выбора не было — `null`,
     и сервер открывает текущую (реестр §S-50, `openWeekReason`). */
  const [week, setWeek] = useState<string | null>(null);
  const [state, reload] = useAsync(
    async () => (subj ? api.journal(cls.id, subj.id, week ?? undefined) : null),
    [cls.id, subj?.id ?? "", week ?? ""],
  );
  const { toast, showToast } = useToast();

  const go = (nextClass: string, nextSubject: string | null) => {
    // Другой класс — другой набор недель с уроками: держать выбор прежним
    // значило бы открыть неделю, которой у нового предмета может не быть.
    setWeek(null);
    navigate(`/journal?classId=${nextClass}${nextSubject ? `&subjectId=${nextSubject}` : ""}`);
  };

  const selects = (
    <div className="sch-toolbar">
      <div className="sch-field sch-field--inline">
        <span className="sch-field-label">Класс</span>
        <select
          className="sch-input"
          data-testid="S-50.select.class"
          value={cls.id}
          onChange={(e) => go(e.target.value, null)}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sch-field sch-field--inline">
        <span className="sch-field-label">Предмет</span>
        <select
          className="sch-input"
          data-testid="S-50.select.subject"
          value={subj?.id ?? ""}
          disabled={forClass.length === 0}
          onChange={(e) => go(cls.id, e.target.value)}
        >
          {forClass.length === 0 ? <option value="">предметов у класса нет</option> : null}
          {forClass.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <>
      <div className="sch-page-head">
        <h1>Журнал</h1>
      </div>
      {selects}
      {state.status === "loading" ? <Skeletons count={8} kind="row" /> : null}
      {state.status === "error" ? <ErrorState message={state.message} onRetry={reload} /> : null}
      {state.status === "ready" ? (
        <JournalTable
          data={state.data}
          subjectName={subj?.name ?? ""}
          onChanged={reload}
          onWeek={setWeek}
          showToast={showToast}
        />
      ) : null}
      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

// ─────────────────────────── S-50 · таблица ───────────────────────────

type Layer =
  | { kind: "topic"; col: JournalColumnDto; anchor: DOMRect }
  | { kind: "mark"; col: JournalColumnDto; row: JournalRowDto; anchor: DOMRect };

function JournalTable({
  data,
  subjectName,
  onChanged,
  onWeek,
  showToast,
}: {
  data: import("@edustore/shared").JournalDto | null;
  subjectName: string;
  onChanged: () => void;
  onWeek: (monday: string) => void;
  showToast: (t: string) => void;
}) {
  const me = useSession();
  const mobile = useIsMobile();
  const userId = me.state.status === "authed" ? me.state.me.userId : "";
  const isModerator = me.can("school.manage");
  const mayMarkAt = (c: JournalColumnDto) => me.can("journal.mark.post") && (isModerator || c.teacherId === userId);
  const maySetTopicAt = (c: JournalColumnDto) => me.can("journal.topic.set") && (isModerator || c.teacherId === userId);

  const [layer, setLayer] = useState<Layer | null>(null);
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const grid = useRef<HTMLTableElement>(null);

  // Порядковый номер урока внутри даты: два урока в дату дают «4.09 (1)» и
  // «4.09 (2)» — две колонки под одним числом со скобкой (§10).
  const ordinals = useMemo(() => {
    const perDate = new Map<string, number>();
    const total = new Map<string, number>();
    for (const c of data?.columns ?? []) total.set(c.date, (total.get(c.date) ?? 0) + 1);
    const out = new Map<string, string>();
    for (const c of data?.columns ?? []) {
      const n = (perDate.get(c.date) ?? 0) + 1;
      perDate.set(c.date, n);
      out.set(c.lessonId, (total.get(c.date) ?? 0) > 1 ? `${shortDate(c.date)} (${n})` : shortDate(c.date));
    }
    return out;
  }, [data]);

  const openMark = useCallback(
    (col: JournalColumnDto, row: JournalRowDto, el: HTMLElement) => {
      if (col.future) return showToast(LESSON_NOT_HELD);
      if (col.detached) return showToast(LESSON_DETACHED);
      if (row.deactivated) return showToast(STUDENT_INACTIVE);
      if (!mayMarkAt(col)) return; // чужой урок: таблица на чтение, слой не открывается
      setLayer({ kind: "mark", col, row, anchor: el.getBoundingClientRect() });
    },
    [mayMarkAt, showToast],
  );

  if (!data) {
    return (
      <EmptyState
        testId="S-50.empty"
        title="Уроки появятся после подтверждения расписания"
        hint="У класса нет предметов — заведите их и соберите сетку"
        action={
          <Button kind="primary" onClick={() => navigate("/subjects")}>
            К предметам
          </Button>
        }
      />
    );
  }

  if (data.columns.length === 0) {
    // Различие двух пустых состояний — по календарю: каникулы школа знает от
    // календаря (AR-68), а неподтверждённая сетка — это отсутствие уроков вовсе.
    return data.nextSchoolDay ? (
      <EmptyState
        testId="S-50.empty.holidays"
        title="Каникулы"
        hint={`Ближайший учебный день — ${longDate(data.nextSchoolDay)}`}
      />
    ) : (
      <EmptyState
        testId="S-50.empty"
        title="Уроки появятся после подтверждения расписания"
        hint="Сетка ещё не подтверждена — уроков в календаре нет"
        action={
          <Button kind="primary" onClick={() => navigate("/schedule")}>
            К расписанию
          </Button>
        }
      />
    );
  }

  const cols = data.columns;
  const rows = data.rows;

  // Стрелки перемещают активную ячейку, Enter открывает выбор отметки (§0).
  const onKeyDown = (e: React.KeyboardEvent) => {
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const r = Math.min(rows.length - 1, Math.max(0, active.r + dr));
      const c = Math.min(cols.length - 1, Math.max(0, active.c + dc));
      setActive({ r, c });
      grid.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)?.focus();
    };
    if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "Enter") {
      const el = grid.current?.querySelector<HTMLElement>(`[data-cell="${active.r}:${active.c}"]`);
      if (el) openMark(cols[active.c], rows[active.r], el);
    }
  };

  return (
    <>
      <WeekStrip weeks={data.weeks} open={data.week} reason={data.openWeekReason} termNo={data.termNo} onWeek={onWeek} />

      <div className="sch-journal">
        <table data-testid="S-50.table" ref={grid} onKeyDown={onKeyDown}>
          <thead>
            <tr>
              <th className="sch-j-name">Ученик</th>
              {cols.map((c) => (
                <th
                  key={c.lessonId}
                  className={c.future ? "sch-j-col--future" : c.detached ? "sch-j-col--detached" : undefined}
                  data-testid={c.future ? "S-50.col.future" : c.detached ? "S-50.col.detached" : undefined}
                >
                  <button
                    type="button"
                    className="sch-j-colhead"
                    data-testid="S-50.colhead.date"
                    title={c.topic ?? "Тема не заполнена"}
                    onClick={(e) => {
                      if (c.future) return showToast(LESSON_NOT_HELD);
                      if (c.detached) return showToast(LESSON_DETACHED);
                      if (!maySetTopicAt(c)) return;
                      setLayer({ kind: "topic", col: c, anchor: e.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    {ordinals.get(c.lessonId)}
                  </button>
                  {c.detached ? <span className="sch-j-detach-note">вне расписания</span> : null}
                </th>
              ))}
              <th className="sch-j-avg">Средний</th>
              <th className="sch-j-avg">Четвертная</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr
                key={r.studentId}
                className={
                  r.deactivated
                    ? "sch-row--inactive"
                    : r.sex === "m"
                      ? "sch-row--boy"
                      : r.sex === "f"
                        ? "sch-row--girl"
                        : undefined
                }
                data-testid={r.deactivated ? "S-50.row.inactive" : undefined}
              >
                <th className="sch-j-name" scope="row" title={fio(r)}>
                  {mobile ? fioShort(r) : fio(r)}{" "}
                  {r.deactivated ? <Badge muted>деактивирован</Badge> : null}
                </th>
                {cols.map((c, ci) => (
                  <td
                    key={c.lessonId}
                    className={`sch-j-cell${c.future ? " sch-j-col--future" : ""}${c.detached ? " sch-j-col--detached" : ""}`}
                    data-testid="S-50.cell.mark"
                    data-cell={`${ri}:${ci}`}
                    tabIndex={active.r === ri && active.c === ci ? 0 : -1}
                    onFocus={() => setActive({ r: ri, c: ci })}
                    onClick={(e) => openMark(c, r, e.currentTarget)}
                  >
                    {r.marks[c.lessonId] ? <MarkChip value={r.marks[c.lessonId]} /> : null}
                  </td>
                ))}
                <td className="sch-j-avg" data-testid="S-50.col.average">
                  {r.average === null ? "—" : r.average.toFixed(2)}
                </td>
                {/* Четвертная, которая ВЫХОДИТ: округление среднего за
                    четверть. Прогноз по ходу периода, не выставленная итоговая
                    — выставления в 1.1.1 нет, и обещать его нечем. */}
                <td className="sch-j-avg" data-testid="S-50.col.termGrade">
                  {r.termGrade === null ? "—" : <MarkChip value={String(r.termGrade) as MarkValue} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {layer?.kind === "topic" ? (
        <TopicPopover
          col={layer.col}
          subjectName={subjectName}
          anchor={layer.anchor}
          onClose={() => setLayer(null)}
          onSaved={() => {
            setLayer(null);
            onChanged();
          }}
          showToast={showToast}
        />
      ) : null}

      {layer?.kind === "mark" ? (
        <MarkPopover
          col={layer.col}
          row={layer.row}
          anchor={layer.anchor}
          onClose={() => setLayer(null)}
          onSaved={() => {
            setLayer(null);
            onChanged();
          }}
          showToast={showToast}
        />
      ) : null}
    </>
  );
}

/**
 * `S-50.weeks` — строка календаря над журналом.
 *
 * Открытая неделя приезжает с сервера вместе с причиной: он один знает
 * календарь и то, идёт ли сейчас учебный год. Причину экран проговаривает
 * словами — «сегодня каникулы, открыта ближайшая учебная неделя» честнее, чем
 * молча показанная не та неделя, в которой учитель не найдёт своих уроков.
 */
function WeekStrip({
  weeks,
  open,
  reason,
  termNo,
  onWeek,
}: {
  weeks: JournalWeekDto[];
  open: string;
  reason: "current" | "nearest" | "requested";
  termNo: 1 | 2 | 3 | 4 | null;
  onWeek: (monday: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);

  // Открытая неделя подкручивается в поле зрения: учебный год — это 34+ недели,
  // и без этого сентябрь встречал бы человека прокруткой до апреля.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [open]);

  if (weeks.length === 0) return null;

  return (
    <div className="sch-weeks" data-testid="S-50.weeks">
      <div className="sch-weeks-strip" ref={strip}>
        {weeks.map((w) => {
          const isOpen = w.monday === open;
          return (
            <button
              key={w.monday}
              className="sch-week"
              data-testid={isOpen ? "S-50.week.current" : undefined}
              data-term={w.termNo ?? undefined}
              data-empty={!w.hasLessons || undefined}
              aria-current={isOpen}
              onClick={() => onWeek(w.monday)}
            >
              <span className="sch-week-range">{weekLabel(w)}</span>
              <span className="sch-week-term">{w.termNo ? `${w.termNo} четв.` : "каникулы"}</span>
            </button>
          );
        })}
      </div>
      <p className="sch-muted" data-testid="S-50.week.note">
        {reason === "current"
          ? `Текущая неделя${termNo ? `, ${termNo} четверть` : ""}`
          : reason === "nearest"
            ? "Сегодня вне учебных недель — открыта ближайшая неделя с уроками"
            : `Выбранная неделя${termNo ? `, ${termNo} четверть` : " — каникулы"}`}
      </p>
    </div>
  );
}

/** «8–14 сент.»; неделя на стыке месяцев — «29 сент. – 5 окт.». */
function weekLabel(w: JournalWeekDto): string {
  const m = (iso: string) => MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
  const d = (iso: string) => Number(iso.slice(8, 10));
  return m(w.monday) === m(w.sunday)
    ? `${d(w.monday)}–${d(w.sunday)} ${m(w.sunday)}`
    : `${d(w.monday)} ${m(w.monday)} – ${d(w.sunday)} ${m(w.sunday)}`;
}

const MONTHS_SHORT = ["янв.", "фев.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];

// ─────────────────────────── S-51 · тема урока ───────────────────────────

function TopicPopover({
  col,
  subjectName,
  anchor,
  onClose,
  onSaved,
  showToast,
}: {
  col: JournalColumnDto;
  subjectName: string;
  anchor: DOMRect;
  onClose: () => void;
  onSaved: () => void;
  showToast: (t: string) => void;
}) {
  const [topic, setTopic] = useState(col.topic ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <PopoverOrSheet anchor={anchor} onClose={onClose} label="Тема урока" testId="S-51" width={320}>
      <div className="sch-stack sch-pop-form">
        <label className="sch-field">
          <span className="sch-field-label">Тема урока</span>
          <input
            className="sch-input"
            data-testid="S-51.input.topic"
            value={topic}
            autoFocus
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <p className="sch-muted" data-testid="S-51.meta">
          {longDate(col.date)} · {col.slotNo}-й урок · {subjectName}
        </p>
        <Button
          kind="primary"
          testId="S-51.btn.save"
          loading={busy}
          disabled={!topic.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await api.setTopic(col.lessonId, topic.trim());
              onSaved();
            } catch (e) {
              // Отказ показывается словами сервера, а не проглатывается (AR-40).
              showToast(e instanceof SchoolApiError ? e.message : "Не удалось сохранить тему");
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить
        </Button>
      </div>
    </PopoverOrSheet>
  );
}

// ─────────────────────────── S-52 · выбор отметки ───────────────────────────

function MarkPopover({
  col,
  row,
  anchor,
  onClose,
  onSaved,
  showToast,
}: {
  col: JournalColumnDto;
  row: JournalRowDto;
  anchor: DOMRect;
  onClose: () => void;
  onSaved: () => void;
  showToast: (t: string) => void;
}) {
  const [busy, setBusy] = useState<MarkValue | "clear" | null>(null);
  const current = row.marks[col.lessonId] ?? null;

  const run = async (what: MarkValue | "clear") => {
    setBusy(what);
    try {
      if (what === "clear") await api.removeMark(col.lessonId, row.studentId);
      else await api.postMark(col.lessonId, row.studentId, what);
      onSaved();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не удалось сохранить отметку");
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <PopoverOrSheet anchor={anchor} onClose={onClose} label={`Отметка · ${fio(row)}`} testId="S-52" width={280}>
      <div className="sch-stack sch-pop-form">
        <p className="sch-muted">
          {fio(row)} · {longDate(col.date)}
        </p>
        {/* Порядок чипов фиксирован: 5 4 3 2 н б (AR-79) — он приходит из
            общего контракта, а не из вёрстки. */}
        <div className="sch-markrow">
          {MARK_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              className={`sch-mark sch-mark--${markKey(m)} sch-mark--btn${current === m ? " is-current" : ""}`}
              data-testid={`S-52.chip.${markKey(m)}`}
              disabled={busy !== null}
              aria-pressed={current === m}
              onClick={() => void run(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <Button
          kind="ghost"
          testId="S-52.btn.clear"
          disabled={current === null}
          loading={busy === "clear"}
          onClick={() => void run("clear")}
        >
          Убрать отметку
        </Button>
      </div>
    </PopoverOrSheet>
  );
}
