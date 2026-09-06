/**
 * `S-30` · штатное расписание и почасовая нагрузка (AR-212).
 *
 * Правый рельс раздела «Персонал» и две таблицы, которые он открывает ВМЕСТО
 * карточек педагогов. Модуль отделён от `staff.tsx` намеренно: карточки и
 * таблицы — два разных вида одного раздела, а не один экран на 1800 строк;
 * реестр элементов знает про оба файла (`check-testids.mjs`, карта `HOME`).
 *
 * Чего здесь НЕТ и почему:
 *   · собственного хранилища часов. Строка таблицы — это `SchoolSubject`
 *     (предмет × класс) и `TeacherBinding` (педагог + норма), те же записи,
 *     что ведут «Предметы» и «Расписание». Таблица — ВИД, а не вторая копия
 *     (П-5): введённое здесь тут же видно в «Нормах часов» `M-22`, и наоборот;
 *   · собственных маршрутов API. Пишется существующими операциями §11:
 *     `POST /subjects` (13), `POST /subjects/:id/teachers/manual` (15а),
 *     `DELETE /subjects/:id/teachers/:tid` (16), `DELETE /subjects/:id` (28),
 *     `PUT /schedule/load` (18). Нового контракта таблица не вводит;
 *   · собственных прав. Ими остаются `subject.write` (предмет и педагог) и
 *     `schedule.load.write` (нормы часов). Это РАЗНЫЕ пакеты: модератор
 *     привязывает педагогов, но не ставит нормы (AR-196), завуч ставит нормы,
 *     но не привязывает (решение владельца 2026-08-30 №9), обе половины разом
 *     есть только у администратора. Ячейка, недоступная роли, показывается
 *     текстом — таблица читается целиком всеми, кто читает раздел.
 *
 * Нормы вводятся В НЕДЕЛЮ — как их ведёт владелец, — а хранятся в год
 * (AR-180): конверсия одна, `yearOfWeekly`/`weeklyOfYear`, и она обратима.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SCHOOL_LEVELS,
  levelOfParallel,
  yearOfWeekly,
  type ClassDto,
  type SchoolLevelKey,
  type StaffCardDto,
  type SubjectDto,
} from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { Button, EmptyState, ErrorState, Skeletons } from "../ui";
import { Icon } from "../icons";
import "./staff-workforce.css";

/** Что открыто вместо карточек. `null` — карточки. */
export type WorkforceView = { kind: "staffing"; level: SchoolLevelKey } | { kind: "workload" } | null;

/** Подпись открытого вида — её же несёт заголовок таблицы. */
export function workforceTitle(view: NonNullable<WorkforceView>): string {
  if (view.kind === "workload") return "Почасовая нагрузка";
  return SCHOOL_LEVELS.find((l) => l.key === view.level)?.title ?? "Штатное расписание";
}

// ─────────────────────────── правый рельс ───────────────────────────

/**
 * Тонкий рельс справа: 44px в покое, раскрывается наведением и — для
 * клавиатуры и телефона, где наведения нет, — фокусом внутри и нажатием на
 * корешок. Раскрытая панель НАКРЫВАЕТ контент, а не раздвигает его: иначе
 * таблица переливалась бы при каждом проходе курсора мимо рельса.
 *
 * Крестик появляется в правом верхнем углу рельса ТОЛЬКО когда таблица
 * открыта (`view !== null`) — закрывать нечего, пока показаны карточки.
 */
export function WorkforceRail({
  view,
  onOpen,
  onClose,
}: {
  view: WorkforceView;
  onOpen: (v: NonNullable<WorkforceView>) => void;
  onClose: () => void;
}) {
  /** Раскрыт ветвями: «Штатное расписание» показывает три ступени. */
  const [branch, setBranch] = useState(() => view?.kind === "staffing");
  /** Прижат нажатием на корешок — для телефона и клавиатуры, где наведения нет. */
  const [pinned, setPinned] = useState(false);
  const staffingOpen = view?.kind === "staffing";

  // Открытая ступень всегда видна в рельсе: вернулись на экран с открытой
  // таблицей — ветка уже развёрнута, искать её нажатием не нужно.
  useEffect(() => {
    if (staffingOpen) setBranch(true);
  }, [staffingOpen]);

  return (
    <aside
      className={["sch-rail", view ? "sch-rail--table" : "", pinned ? "sch-rail--pinned" : ""].filter(Boolean).join(" ")}
      data-testid="S-30.rail"
      aria-label="Штатное расписание и нагрузка"
    >
      <div className="sch-rail-panel">
        <div className="sch-rail-head">
          <button
            type="button"
            className="sch-rail-spine"
            aria-expanded={pinned}
            aria-label={pinned ? "Свернуть панель" : "Развернуть панель"}
            onClick={() => setPinned((p) => !p)}
          >
            <Icon name={pinned ? "chevronRight" : "chevronLeft"} size={18} />
          </button>
          {/* Крестик — только при открытой таблице: он сворачивает ТАБЛИЦЫ и
              возвращает карточки, а не прячет сам рельс. */}
          {view ? (
            <button
              type="button"
              className="sch-rail-close"
              data-testid="S-30.rail.btn.close"
              aria-label="Закрыть таблицу и вернуть карточки"
              onClick={onClose}
            >
              <Icon name="close" size={18} />
            </button>
          ) : null}
        </div>

        <nav className="sch-rail-list">
          <RailRow
            testId="S-30.rail.staffing"
            icon="checklist"
            label="Штатное расписание"
            active={staffingOpen}
            expanded={branch}
            onClick={() => setBranch((b) => !b)}
          />
          {branch ? (
            <div className="sch-rail-sub">
              {SCHOOL_LEVELS.map((l) => (
                <RailRow
                  key={l.key}
                  testId={`S-30.rail.level.${l.key}`}
                  label={l.title}
                  sub
                  active={view?.kind === "staffing" && view.level === l.key}
                  onClick={() => onOpen({ kind: "staffing", level: l.key })}
                />
              ))}
            </div>
          ) : null}
          <RailRow
            testId="S-30.rail.workload"
            icon="activity"
            label="Почасовая нагрузка"
            active={view?.kind === "workload"}
            onClick={() => onOpen({ kind: "workload" })}
          />
        </nav>
      </div>
    </aside>
  );
}

function RailRow({
  testId,
  icon,
  label,
  active,
  expanded,
  sub,
  onClick,
}: {
  testId: string;
  icon?: "checklist" | "activity";
  label: string;
  active?: boolean;
  expanded?: boolean;
  sub?: boolean;
  onClick: () => void;
}) {
  const cls = ["sch-rail-row", sub ? "sch-rail-row--sub" : "", active ? "sch-rail-row--active" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      data-testid={testId}
      aria-current={active ? "true" : undefined}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span className="sch-rail-mark" aria-hidden="true">
        <Icon name={icon ?? "chevronRight"} size={18} />
      </span>
      <span className="sch-rail-label">{label}</span>
      {expanded !== undefined ? (
        <span className="sch-rail-chev" aria-hidden="true">
          <Icon name={expanded ? "chevronDown" : "chevronRight"} size={18} />
        </span>
      ) : null}
    </button>
  );
}

// ─────────────────────────── данные таблиц ───────────────────────────

/** Строка «Штатного расписания»: предмет класса и ведущий его педагог. */
interface Row {
  subjectId: string;
  subjectName: string;
  classId: string;
  /** `null` — предмет заведён, педагог не назначен: строка показывается пустой
   *  ячейкой педагога, а не прячется. Иначе прерванное добавление исчезало бы
   *  из таблицы, оставаясь в «Предметах». */
  bindingId: string | null;
  teacherId: string | null;
  teacherName: string | null;
  hoursPerWeek: number;
  /** Привязка на группы (Д6) — часы такой строки в таблице не правятся. */
  groupNos: number[];
}

interface Data {
  classes: ClassDto[];
  subjects: SubjectDto[];
  staff: StaffCardDto[];
}

const rowsOf = (subjects: SubjectDto[]): Row[] =>
  subjects.flatMap<Row>((s) =>
    s.bindings.length === 0
      ? [
          {
            subjectId: s.id,
            subjectName: s.name,
            classId: s.classId,
            bindingId: null,
            teacherId: null,
            teacherName: null,
            hoursPerWeek: 0,
            groupNos: [],
          },
        ]
      : s.bindings.map((b) => ({
          subjectId: s.id,
          subjectName: s.name,
          classId: s.classId,
          bindingId: b.id,
          teacherId: b.teacherId,
          teacherName: b.teacherName,
          hoursPerWeek: b.hoursPerWeek,
          groupNos: b.scope === "group" ? b.groupNos : [],
        })),
  );

/** Педагоги для селекта: заполненные карточки третьей секции (AR-182). */
const teachersOf = (staff: StaffCardDto[]): { id: string; name: string }[] =>
  staff
    .filter((c) => c.filled && !c.deactivated && c.userId && c.roles.includes("teacher"))
    .map((c) => ({ id: c.userId as string, name: c.name ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

// ─────────────────────────── таблицы ───────────────────────────

export function WorkforceTables({
  view,
  canBind,
  canSetHours,
  onError,
  onSaved,
}: {
  view: NonNullable<WorkforceView>;
  canBind: boolean;
  canSetHours: boolean;
  onError: (text: string) => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    Promise.all([api.classes(), api.subjects(), api.staff()])
      .then(([c, s, st]) => {
        if (!alive) return;
        setData({ classes: c.classes, subjects: s, staff: st });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setFailed(e instanceof SchoolApiError ? e.message : "Не удалось загрузить таблицу");
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  if (failed) return <ErrorState message={failed} onRetry={reload} />;
  if (!data) return <Skeletons count={4} kind="row" />;

  const changed = () => {
    reload();
    onSaved();
  };

  return view.kind === "workload" ? (
    <WorkloadTable data={data} />
  ) : (
    <StaffingTable
      level={view.level}
      data={data}
      canBind={canBind}
      canSetHours={canSetHours}
      onError={onError}
      onChanged={changed}
    />
  );
}

/**
 * `S-30.table.staffing` — штатное расписание одной ступени: по классу ступени
 * блок строк «предмет · часов в неделю · педагог». Считаемое в подвале блока —
 * сумма недельных часов класса: она и есть то число, ради которого таблицу
 * ведут, и считается на месте, а не заводится полем.
 */
function StaffingTable({
  level,
  data,
  canBind,
  canSetHours,
  onError,
  onChanged,
}: {
  level: SchoolLevelKey;
  data: Data;
  canBind: boolean;
  canSetHours: boolean;
  onError: (text: string) => void;
  onChanged: () => void;
}) {
  const classes = useMemo(
    () =>
      data.classes
        .filter((c) => levelOfParallel(c.parallel) === level)
        .sort((a, b) => a.parallel - b.parallel || a.label.localeCompare(b.label, "ru")),
    [data.classes, level],
  );
  const rows = useMemo(() => rowsOf(data.subjects), [data.subjects]);
  const teachers = useMemo(() => teachersOf(data.staff), [data.staff]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (classes.length === 0)
    return (
      <EmptyState
        testId="S-30.staffing.empty"
        title="Классов этой ступени нет"
        hint="Ступень собирается из параллелей контингента — заведите классы в разделе «Классы»"
      />
    );

  /** Одна операция таблицы: занять кнопки, показать причину отказа словами. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      onError(e instanceof SchoolApiError ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  /** Норма недели → год (AR-180). Версия расписания берётся СВЕЖЕЙ (AR-109). */
  const setHours = (bindingId: string, weekly: number) =>
    run(async () => {
      const load = await api.load();
      await api.setLoad({ entries: [{ bindingId, hoursPerYear: yearOfWeekly(weekly) }], version: load.version });
    });

  /** Смена педагога строки: открепление прежнего и привязка нового. */
  const setTeacher = (row: Row, teacherId: string) =>
    run(async () => {
      if (row.teacherId === teacherId) return;
      if (row.teacherId) await api.unbindTeacher(row.subjectId, row.teacherId);
      if (teacherId) await api.bindTeacherManual(row.subjectId, { teacherId, scope: "class" });
    });

  const addSubject = (classId: string, name: string) =>
    run(async () => {
      await api.createSubject({ name, classId });
      setAdding(null);
      setDraft("");
    });

  /**
   * Удаление СТРОКИ, а не всегда карточки предмета: у предмета, разделённого
   * на группы (Д6), строк несколько, и `DELETE /subjects/:id` снёс бы вместе с
   * этой строкой чужие. Последняя строка предмета удаляет карточку — иначе
   * предмет остался бы в «Предметах» непокрытой позицией, которую из таблицы
   * уже не убрать.
   */
  const removeRow = (row: Row) => {
    const siblings = rows.filter((r) => r.subjectId === row.subjectId && r.bindingId).length;
    return run(() =>
      row.teacherId && siblings > 1 ? api.unbindTeacher(row.subjectId, row.teacherId) : api.deleteSubject(row.subjectId),
    );
  };

  return (
    <>
      <div className="sch-tablewrap sch-wf" data-testid="S-30.table.staffing">
      <table className="sch-table sch-table--wf">
        <thead>
          <tr>
            <th className="sch-wf-col-subject">Предмет</th>
            <th className="sch-wf-col-hours">Часов в неделю</th>
            <th>Преподаватель</th>
            {canBind ? <th className="sch-wf-col-act" aria-label="Действие" /> : null}
          </tr>
        </thead>
        {classes.map((c) => {
          const mine = rows
            .filter((r) => r.classId === c.id)
            .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "ru"));
          const total = mine.reduce((a, r) => a + r.hoursPerWeek, 0);
          const cols = canBind ? 4 : 3;
          return (
            <tbody key={c.id} className="sch-wf-block">
              <tr className="sch-wf-classhead">
                <th colSpan={cols} scope="colgroup">
                  <span className="sch-wf-classname">{c.label} класс</span>
                  <span className="sch-wf-classmeta">
                    {c.students} уч · {total} ч/нед
                  </span>
                </th>
              </tr>
              {mine.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="sch-muted">
                    Предметов у класса нет
                  </td>
                </tr>
              ) : (
                mine.map((r) => (
                  <tr key={`${r.subjectId}:${r.bindingId ?? "none"}`}>
                    <td>
                      {r.subjectName}
                      {r.groupNos.length > 0 ? (
                        <span className="sch-muted"> · группа {r.groupNos.join(", ")}</span>
                      ) : null}
                    </td>
                    <td>
                      <HoursCell row={r} editable={canSetHours && !!r.bindingId} busy={busy} onSave={setHours} />
                    </td>
                    <td>
                      {canBind ? (
                        <select
                          className="sch-input sch-wf-select"
                          data-testid="S-30.staffing.select.teacher"
                          data-subject-id={r.subjectId}
                          aria-label={`Преподаватель: ${r.subjectName}, ${c.label} класс`}
                          disabled={busy}
                          value={r.teacherId ?? ""}
                          onChange={(e) => setTeacher(r, e.target.value)}
                        >
                          <option value="">— не назначен —</option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={r.teacherName ? undefined : "sch-muted"}>{r.teacherName ?? "не назначен"}</span>
                      )}
                    </td>
                    {canBind ? (
                      <td>
                        <Button
                          kind="ghost"
                          testId="S-30.staffing.btn.removeRow"
                          disabled={busy}
                          aria-label={`Удалить строку: ${r.subjectName}, ${c.label} класс`}
                          onClick={() => removeRow(r)}
                        >
                          <Icon name="trash" size={18} />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
              {canBind ? (
                <tr className="sch-wf-add">
                  <td colSpan={cols}>
                    {adding === c.id ? (
                      <form
                        className="sch-wf-addform"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (draft.trim()) addSubject(c.id, draft.trim());
                        }}
                      >
                        <input
                          className="sch-input"
                          data-testid="S-30.staffing.input.subject"
                          autoFocus
                          placeholder="Название предмета"
                          aria-label={`Новый предмет класса ${c.label}`}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                        <Button type="submit" kind="primary" disabled={busy || !draft.trim()}>
                          Добавить
                        </Button>
                        <Button
                          kind="ghost"
                          onClick={() => {
                            setAdding(null);
                            setDraft("");
                          }}
                        >
                          Отмена
                        </Button>
                      </form>
                    ) : (
                      <Button
                        kind="ghost"
                        testId="S-30.staffing.btn.addRow"
                        disabled={busy}
                        onClick={() => {
                          setAdding(c.id);
                          setDraft("");
                        }}
                      >
                        <Icon name="plus" size={18} /> Добавить предмет
                      </Button>
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          );
        })}
      </table>
      </div>
      {!canBind && !canSetHours ? (
        <p className="sch-muted sch-wf-note">
          Таблица открыта на чтение: предметы и педагогов ведёт модератор, нормы часов — завуч.
        </p>
      ) : null}
    </>
  );
}

/**
 * Ячейка часов: правится на месте, сохраняется по уходу фокуса и по Enter —
 * запрос на каждое нажатие клавиши обесценил бы версию расписания (AR-109).
 * Введённое остаётся видимым, пока запрос летит: подстановка серверного
 * значения под пальцы — не «синхронизация», а потеря ввода.
 */
function HoursCell({
  row,
  editable,
  busy,
  onSave,
}: {
  row: Row;
  editable: boolean;
  busy: boolean;
  onSave: (bindingId: string, weekly: number) => void;
}) {
  const [text, setText] = useState(String(row.hoursPerWeek || ""));
  const server = useRef(row.hoursPerWeek);
  // Значение с сервера сменилось (соседняя правка, перезагрузка) — показываем его,
  // но только если поле не редактируется прямо сейчас.
  useEffect(() => {
    if (server.current !== row.hoursPerWeek) {
      server.current = row.hoursPerWeek;
      setText(String(row.hoursPerWeek || ""));
    }
  }, [row.hoursPerWeek]);

  if (!editable)
    return (
      <span className="sch-wf-hours-ro" title={row.bindingId ? undefined : "Часы ставятся после назначения педагога"}>
        {row.hoursPerWeek || "—"}
      </span>
    );

  const commit = () => {
    const weekly = Math.max(0, Math.round(Number(text.replace(",", ".")) || 0));
    setText(String(weekly || ""));
    if (weekly !== row.hoursPerWeek) onSave(row.bindingId as string, weekly);
  };

  return (
    <input
      className="sch-input sch-wf-hours"
      data-testid="S-30.staffing.input.hours"
      data-binding-id={row.bindingId ?? ""}
      inputMode="numeric"
      disabled={busy}
      aria-label={`Часов в неделю: ${row.subjectName}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * `S-30.table.workload` — почасовая нагрузка: педагог × класс, в клетке сумма
 * недельных часов его привязок в этом классе, в «Ставке» — сумма по строке.
 *
 * Таблица СЧИТАЕТСЯ, а не ведётся: каждое её число — сумма норм из «Штатного
 * расписания», и вводить его отдельно значило бы завести второй источник тех
 * же часов (П-5). Меняются числа там, где ставится норма.
 */
function WorkloadTable({ data }: { data: Data }) {
  const classes = useMemo(
    () => [...data.classes].sort((a, b) => a.parallel - b.parallel || a.label.localeCompare(b.label, "ru")),
    [data.classes],
  );
  const rows = useMemo(() => rowsOf(data.subjects), [data.subjects]);

  /** teacherId → (classId → часы в неделю). Педагоги без привязок в таблицу не идут. */
  const grid = useMemo(() => {
    const acc = new Map<string, { name: string; byClass: Map<string, number> }>();
    for (const r of rows) {
      if (!r.teacherId || !r.bindingId) continue;
      const cur = acc.get(r.teacherId) ?? { name: r.teacherName ?? "—", byClass: new Map<string, number>() };
      cur.byClass.set(r.classId, (cur.byClass.get(r.classId) ?? 0) + r.hoursPerWeek);
      acc.set(r.teacherId, cur);
    }
    return [...acc.entries()]
      .map(([id, v]) => ({ id, name: v.name, byClass: v.byClass }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [rows]);

  if (grid.length === 0)
    return (
      <EmptyState
        testId="S-30.workload.empty"
        title="Нагрузки пока нет"
        hint="Нагрузка складывается из норм «Штатного расписания» — назначьте педагогов и проставьте часы"
      />
    );

  const colTotal = (classId: string) => grid.reduce((a, t) => a + (t.byClass.get(classId) ?? 0), 0);
  const rowTotal = (t: (typeof grid)[number]) => [...t.byClass.values()].reduce((a, h) => a + h, 0);
  const grand = grid.reduce((a, t) => a + rowTotal(t), 0);

  return (
    <>
      <div className="sch-tablewrap sch-wf" data-testid="S-30.table.workload">
      <table className="sch-table sch-table--wf sch-table--numeric">
        <thead>
          <tr>
            <th className="sch-wf-col-fio">ФИО</th>
            {classes.map((c) => (
              <th key={c.id}>{c.label} класс</th>
            ))}
            <th className="sch-wf-col-total">Ставка</th>
          </tr>
          <tr className="sch-wf-totals">
            <th scope="row">Итого</th>
            {classes.map((c) => (
              <td key={c.id}>{colTotal(c.id) || ""}</td>
            ))}
            <td>{grand || ""}</td>
          </tr>
        </thead>
        <tbody>
          {grid.map((t) => (
            <tr key={t.id}>
              <th scope="row" className="sch-wf-fio">
                {t.name}
              </th>
              {classes.map((c) => (
                <td key={c.id} className={t.byClass.get(c.id) ? undefined : "sch-wf-zero"}>
                  {t.byClass.get(c.id) ?? 0}
                </td>
              ))}
              <td className="sch-wf-total">{rowTotal(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="sch-muted sch-wf-note">
        Числа считаются из норм «Штатного расписания»: в клетке — сумма недельных часов привязок педагога в этом
        классе. Отдельно они не вводятся — меняются там, где ставится норма.
      </p>
    </>
  );
}
