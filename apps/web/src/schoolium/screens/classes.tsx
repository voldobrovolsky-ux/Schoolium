/**
 * Классы и контингент: `S-10` сетка, `S-11` мастер (`M-01`), `S-12` карточка
 * класса, `S-13` профиль ученика (`M-02`), подтверждение удаления (`M-13`),
 * выход из мастера (`M-14`).
 *
 * Ключевые правила экрана:
 *   · каждый опциональный параметр мастера имеет ЯВНУЮ кнопку отказа (AR-77):
 *     «⌀ Без литер», «⌀ Без групп» — невыбранность дальше не пускает;
 *   · превью шага 5 перечисляет ИМЕНА классов, а не показывает «32 класса» —
 *     смысл проверки в том, чтобы человек увидел произведение до создания (Д5);
 *   · подмену кнопки «удалить» → «деактивировать» решает СЕРВЕР (`hasMarks`);
 *   · `M-13` называет ДЕЙСТВИТЕЛЬНЫЙ объём потери — заполненные профили отдельно
 *     от пустых (AR-105), и кнопка подтверждения при этом `B-danger`.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ACCESS_PARAMS, type ClassDto, type CredentialsDto, type StudentAccessDto, type StudentDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile, usePolling } from "../hooks";
import { Badge, Button, EmptyState, ErrorState, Field, Modal, NumberField, Skeletons, useToast, Toast } from "../ui";
import { useSession } from "../session";
import { navigate } from "../router";
import { CredentialsBox } from "./account-form";

const LETTERS = ["А", "Б", "В", "Г", "Д"];

// ─────────────────────────── S-10 · Классы ───────────────────────────

export function ClassesScreen() {
  const { can } = useSession();
  const [state, reload] = useAsync(() => api.classes());
  const [wizard, setWizard] = useState(false);
  const mayWrite = can("contingent.write");

  if (state.status === "loading") return <Skeletons count={8} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const { classes, version } = state.data;

  return (
    <>
      <div className="sch-page-head">
        <h1>Классы</h1>
        {/* Кнопка, недоступная роли, НЕ рендерится (AR-69). */}
        {mayWrite && classes.length > 0 ? (
          <Button kind="primary" testId="S-10.btn.newClasses" onClick={() => setWizard(true)}>
            Создать классы
          </Button>
        ) : null}
      </div>

      {classes.length === 0 ? (
        <EmptyState
          testId="S-10.empty"
          title="Классов пока нет"
          hint={mayWrite ? "Создайте классы — с этого начинается школа" : "Классы появятся, когда модератор их создаст"}
          action={
            mayWrite ? (
              <Button kind="primary" testId="S-10.btn.newClasses" onClick={() => setWizard(true)}>
                Создать классы
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="sch-cards--4" data-testid="S-10.grid.classes">
          {classes.map((c) => (
            <ClassCard key={c.id} cls={c} />
          ))}
        </div>
      )}

      {wizard ? (
        <ClassesWizard
          version={version}
          onClose={() => setWizard(false)}
          onDone={() => {
            setWizard(false);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function ClassCard({ cls }: { cls: ClassDto }) {
  const filled = cls.totalProfiles > 0 ? Math.round((cls.filledProfiles / cls.totalProfiles) * 100) : 0;
  return (
    <button
      className="sch-card sch-card--clickable"
      data-testid="S-10.card.class"
      data-class-id={cls.id}
      onClick={() => navigate(`/classes/${cls.id}`)}
    >
      <div className="sch-card-title">{cls.letter ? `${cls.label}` : `${cls.label} класс`}</div>
      <div className="sch-card-sub">
        {cls.students} учеников{cls.groupCount ? ` · ${cls.groupCount} группы` : ""}
      </div>
      {/* Полоса заполнения профилей — `violet-500` (`60-design.md`). */}
      <div className="sch-progress" aria-label={`Заполнено ${cls.filledProfiles} из ${cls.totalProfiles}`}>
        <span style={{ width: `${filled}%` }} />
      </div>
    </button>
  );
}

// ─────────────────────────── S-11 · мастер классов (M-01) ───────────────────────────

interface WizardState {
  parallels: string;
  letters: string[] | null;
  students: string;
  groups: number | null;
  groupsChosen: boolean;
  sexKind: "boys" | "girls";
  sexCount: string;
  /** Правки по классам: имя класса → численность и число детей названного пола. */
  rows: Record<string, { students: string; sexCount: string }>;
}

const EMPTY: WizardState = {
  parallels: "",
  letters: undefined as unknown as string[],
  students: "",
  groups: null,
  groupsChosen: false,
  sexKind: "boys",
  sexCount: "",
  rows: {},
};

export function ClassesWizard({ version, onClose, onDone }: { version: number; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [w, setW] = useState<WizardState>({ ...EMPTY, letters: undefined as unknown as string[] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  const dirty = w.parallels !== "" || w.students !== "" || w.letters !== undefined || w.groupsChosen;
  const close = () => (dirty ? setConfirmExit(true) : onClose());

  const parallels = Number(w.parallels);
  const students = Number(w.students);
  const sexCount = Number(w.sexCount);
  const lettersChosen = w.letters !== undefined;

  const stepValid = (n: number): boolean => {
    if (n === 1) return parallels >= 1 && parallels <= 11;
    if (n === 2) return lettersChosen;
    if (n === 3) return students >= 1 && students <= 40;
    if (n === 4) return w.groupsChosen;
    if (w.sexCount === "" || sexCount < 0 || sexCount > students) return false;
    // Правка строки не должна пропускать заведомо невозможный класс: пустая
    // строка — это «как у всех», а заполненная проверяется теми же границами.
    return names().every((n) => {
      const r = w.rows[n];
      if (!r) return true;
      const st = r.students === "" ? students : Number(r.students);
      const sx = r.sexCount === "" ? sexCount : Number(r.sexCount);
      if (!Number.isFinite(st) || st < 1 || st > 40) return false;
      if (!Number.isFinite(sx) || sx < 0 || sx > st) return false;
      if (w.groups !== null && w.groups > st) return false;
      return true;
    });
  };

  const names = (): string[] => {
    const ls = w.letters && w.letters.length ? w.letters : [null];
    const out: string[] = [];
    for (let p = 1; p <= parallels; p += 1) for (const l of ls) out.push(l ? `${p}${l}` : String(p));
    return out;
  };

  /**
   * Строки таблицы, реально отличающиеся от общего значения. Пустая строка —
   * «как у всех», и отправлять её значит записать в контракт то, чего человек
   * не вводил.
   */
  const perClass = () => {
    const out = names()
      .map((label) => {
        const r = w.rows[label];
        const st = r && r.students !== "" ? Number(r.students) : students;
        const sx = r && r.sexCount !== "" ? Number(r.sexCount) : sexCount;
        return { label, students: st, sexCount: sx };
      })
      .filter((r) => r.students !== students || r.sexCount !== sexCount);
    return out.length ? out : null;
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createClasses({
        parallels,
        letters: w.letters && w.letters.length ? w.letters : null,
        studentsPerClass: students,
        groups: w.groups,
        sexKind: w.sexKind,
        sexCount,
        perClass: perClass(),
        version,
      });
      onDone();
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не удалось создать классы");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title="Создание классов"
        width={640}
        onClose={close}
        testId="M-01"
        mobile="fullscreen"
        onBack={step > 1 ? () => setStep(step - 1) : undefined}
        footer={
          <div className="sch-actions">
            {step > 1 ? (
              <Button kind="ghost" testId="M-01.back" onClick={() => setStep(step - 1)}>
                Назад
              </Button>
            ) : null}
            {step < 5 ? (
              <Button kind="primary" testId="M-01.next" disabled={!stepValid(step)} onClick={() => setStep(step + 1)}>
                Далее
              </Button>
            ) : (
              <Button kind="primary" testId="S-11.btn.create" disabled={!stepValid(5)} loading={busy} onClick={create}>
                Создать
              </Button>
            )}
          </div>
        }
      >
        <div className="sch-steps">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="sch-step-dot" data-done={n <= step} />
          ))}
        </div>

        {step === 1 ? (
          <NumberField
            label="Сколько параллелей создать"
            testId="S-11.input.parallels"
            min={1}
            max={11}
            value={w.parallels}
            onValue={(v) => setW({ ...w, parallels: v })}
            error={w.parallels !== "" && !stepValid(1) ? "Укажите от 1 до 11" : null}
          />
        ) : null}

        {step === 2 ? (
          <div className="sch-stack">
            <span className="sch-field-label">Диапазон литер</span>
            <div className="sch-chips" data-testid="S-11.seg.letters">
              {LETTERS.map((l) => {
                const on = (w.letters ?? []).includes(l);
                return (
                  <Button
                    key={l}
                    kind="chip"
                    aria-pressed={on}
                    onClick={() => {
                      const cur = w.letters ?? [];
                      setW({ ...w, letters: on ? cur.filter((x) => x !== l) : [...cur, l] });
                    }}
                  >
                    {l}
                  </Button>
                );
              })}
            </div>
            {/* Явный маркер отсутствия (AR-77): пустое поле выбором не считается. */}
            <Button
              kind="off"
              testId="S-11.btn.noLetters"
              aria-pressed={Array.isArray(w.letters) && w.letters.length === 0}
              onClick={() => setW({ ...w, letters: [] })}
            >
              ⌀ Без литер
            </Button>
            {!lettersChosen ? <span className="sch-field-error">Выберите литеры или нажмите «Без литер»</span> : null}
          </div>
        ) : null}

        {step === 3 ? (
          <NumberField
            label="Учеников в каждом классе"
            testId="S-11.input.students"
            min={1}
            max={40}
            value={w.students}
            onValue={(v) => setW({ ...w, students: v })}
            error={w.students !== "" && !stepValid(3) ? "Укажите от 1 до 40" : null}
          />
        ) : null}

        {step === 4 ? (
          <div className="sch-stack">
            <NumberField
              label="Групп в классе"
              testId="S-11.input.groups"
              min={2}
              max={4}
              value={w.groups === null ? "" : String(w.groups)}
              onValue={(raw) => {
                const v = Number(raw);
                setW({ ...w, groups: Number.isFinite(v) && raw !== "" ? v : null, groupsChosen: raw !== "" });
              }}
              error={
                w.groups !== null && (w.groups < 2 || w.groups > 4)
                  ? "Групп может быть от 2 до 4"
                  : w.groups !== null && w.groups > students
                    ? "Групп не больше, чем учеников: в классе из 1 ученика деления нет"
                    : null
              }
            />
            <Button
              kind="off"
              testId="S-11.btn.noGroups"
              aria-pressed={w.groupsChosen && w.groups === null}
              onClick={() => setW({ ...w, groups: null, groupsChosen: true })}
            >
              ⌀ Без групп
            </Button>
            {!w.groupsChosen ? (
              <span className="sch-field-error">Укажите число групп или нажмите «Без групп»</span>
            ) : null}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="sch-stack">
            <div className="sch-radio" data-testid="S-11.radio.sexKind">
              <label>
                <input
                  type="radio"
                  name="sexKind"
                  checked={w.sexKind === "boys"}
                  onChange={() => setW({ ...w, sexKind: "boys" })}
                />
                Указываю мальчиков
              </label>
              <label>
                <input
                  type="radio"
                  name="sexKind"
                  checked={w.sexKind === "girls"}
                  onChange={() => setW({ ...w, sexKind: "girls" })}
                />
                Указываю девочек
              </label>
            </div>
            <NumberField
              label={w.sexKind === "boys" ? "Мальчиков в классе" : "Девочек в классе"}
              testId="S-11.input.sexCount"
              min={0}
              max={students || 0}
              value={w.sexCount}
              onValue={(v) => setW({ ...w, sexCount: v })}
              error={w.sexCount !== "" && sexCount > students ? "Не больше численности класса" : null}
            />
            {/* Второй пол вычисляется как разность и показывается ДО подтверждения. */}
            <p className="sch-muted" data-testid="S-11.calc.otherSex">
              {w.sexKind === "boys" ? "Девочек" : "Мальчиков"}: {Math.max(0, students - (sexCount || 0))} — посчитано
              автоматически
            </p>
            {/* Поклассная таблица. Одно число на школу — ложь про любую реальную
                школу, поэтому общее значение здесь только заполняет столбцы, а
                каждая строка правится отдельно. */}
            <div className="sch-headcount" data-testid="S-11.table.perClass">
              <div className="sch-headcount-head">
                <span>Класс</span>
                <span>Учеников</span>
                <span>{w.sexKind === "boys" ? "Мальчиков" : "Девочек"}</span>
                <span>{w.sexKind === "boys" ? "Девочек" : "Мальчиков"}</span>
              </div>
              {names().map((label) => {
                const r = w.rows[label] ?? { students: "", sexCount: "" };
                const st = r.students === "" ? students : Number(r.students);
                const sx = r.sexCount === "" ? sexCount : Number(r.sexCount);
                const bad = !Number.isFinite(st) || st < 1 || st > 40 || !Number.isFinite(sx) || sx < 0 || sx > st;
                const set = (patch: Partial<{ students: string; sexCount: string }>) =>
                  setW({ ...w, rows: { ...w.rows, [label]: { ...r, ...patch } } });
                return (
                  <div className="sch-headcount-row" data-testid={`S-11.row.${label}`} key={label} data-bad={bad}>
                    <span className="sch-headcount-label">{label}</span>
                    <input
                      className="sch-headcount-input"
                      data-testid={`S-11.row.${label}.students`}
                      type="number"
                      min={1}
                      max={40}
                      placeholder={String(students || "")}
                      value={r.students}
                      onChange={(e) => set({ students: e.target.value })}
                      aria-label={`Учеников в классе ${label}`}
                    />
                    <input
                      className="sch-headcount-input"
                      data-testid={`S-11.row.${label}.sex`}
                      type="number"
                      min={0}
                      max={st || 0}
                      placeholder={String(sexCount === 0 ? 0 : sexCount || "")}
                      value={r.sexCount}
                      onChange={(e) => set({ sexCount: e.target.value })}
                      aria-label={`${w.sexKind === "boys" ? "Мальчиков" : "Девочек"} в классе ${label}`}
                    />
                    <span className="sch-headcount-rest">{Number.isFinite(st) && Number.isFinite(sx) ? Math.max(0, st - sx) : "—"}</span>
                  </div>
                );
              })}
            </div>
            <p className="sch-muted">
              Пустое поле — как у всех: {students || 0} учеников, из них{" "}
              {w.sexKind === "boys" ? "мальчиков" : "девочек"} {sexCount || 0}.
            </p>

            {/* Превью перечисляет ИМЕНА, а не число: смысл проверки — увидеть произведение (Д5). */}
            <div className="sch-preview" data-testid="S-11.preview">
              Будет создано {names().length} классов: {names().join(", ")} · всего учеников{" "}
              {names().reduce((acc, n) => {
                const r = w.rows[n];
                const st = r && r.students !== "" ? Number(r.students) : students;
                return acc + (Number.isFinite(st) ? st : 0);
              }, 0)}
            </div>
            {error ? (
              <p className="sch-danger-text" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* M-14 — выход из мастера с введёнными данными (§3). */}
      {confirmExit ? (
        <Modal
          title="Закрыть без сохранения?"
          width={400}
          onClose={() => setConfirmExit(false)}
          testId="M-14"
        mobile="sheet"
          footer={
            <div className="sch-actions">
              <Button kind="ghost" onClick={() => setConfirmExit(false)}>
                Продолжить ввод
              </Button>
              <Button kind="danger" onClick={onClose}>
                Закрыть без сохранения
              </Button>
            </div>
          }
        >
          <p>Введённые данные не сохранятся.</p>
        </Modal>
      ) : null}
    </>
  );
}

// ─────────────────────────── S-12 · карточка класса ───────────────────────────

export function ClassScreen({ classId }: { classId: string }) {
  const { can } = useSession();
  const [state, reload] = useAsync(async () => {
    const [cls, students] = await Promise.all([api.schoolClass(classId), api.students(classId)]);
    return { cls, students };
  }, [classId]);
  const [editing, setEditing] = useState<StudentDto | "new" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "class" } | { kind: "student"; student: StudentDto }>(null);
  const { toast, showToast } = useToast();
  const mobile = useIsMobile();
  const mayWrite = can("contingent.write");

  if (state.status === "loading") return <Skeletons count={10} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const { cls, students } = state.data;
  const current = students.find((s) => s.id === selected) ?? null;

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    }
  };

  return (
    <>
      <div className="sch-page-head">
        <h1 data-testid="S-12.title">
          {cls.letter ? cls.label : `${cls.label} класс`} · {cls.students} учеников
          {cls.groupCount ? ` · ${cls.groupCount} группы` : ""}
        </h1>
      </div>

      <div className="sch-tablewrap">
        {/* На мобайле таблица скроллится ВНУТРИ контейнера, а колонка
            «Фамилия» закреплена (§6): номер строки при этом уходит — он
            производный от порядка, а фамилия и есть строка. */}
        <table className="sch-table sch-table--roster" data-testid="S-12.table.roster">
          <thead>
            <tr>
              <th>№</th>
              <th>Фамилия</th>
              <th>Имя</th>
              <th>Отчество</th>
              <th>Группа</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => {
              const cls2 = !s.filled
                ? "sch-row--empty"
                : s.deactivated
                  ? "sch-row--inactive"
                  : s.sex === "m"
                    ? "sch-row--boy"
                    : "sch-row--girl";
              return (
                <tr
                  key={s.id}
                  className={cls2}
                  data-testid={s.filled ? "S-12.row.student" : "S-12.row.empty"}
                  data-student-id={s.id}
                  aria-selected={selected === s.id}
                  onClick={() => {
                    setSelected(s.id);
                    if (mayWrite) setEditing(s);
                  }}
                >
                  <td>{i + 1}</td>
                  <td>
                    {s.filled ? s.lastName : <span>тапните, чтобы заполнить профиль</span>}{" "}
                    {s.deactivated ? <span data-testid="S-12.badge.inactive"><Badge muted>деактивирован</Badge></span> : null}
                  </td>
                  <td>{s.firstName}</td>
                  <td>{s.middleName ?? ""}</td>
                  <td>{s.groupNo ? `Группа ${s.groupNo}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {mayWrite ? (
        /* Кнопки действий на мобайле — прилипающая панель снизу (§6): список
           контингента длинный, и уводить действия за его конец значит прятать
           их от человека, который до конца не долистает. */
        <div
          className={mobile ? "sch-sticky-actions" : "sch-actions sch-actions--start"}
          style={mobile ? undefined : { marginTop: "var(--sp-16)" }}
        >
          <Button kind="secondary" testId="S-12.btn.addStudent" onClick={() => setEditing("new")}>
            Добавить ученика
          </Button>
          <Button kind="secondary" testId="S-12.btn.editStudent" disabled={!current} onClick={() => current && setEditing(current)}>
            Редактировать
          </Button>
          {/* Подмену решает СЕРВЕР: ровно одна кнопка из двух (AR-78). */}
          {current && current.deactivated ? (
            <Button kind="secondary" testId="S-12.btn.reactivateStudent" onClick={() => act(() => api.reactivateStudent(current.id))}>
              Вернуть в класс
            </Button>
          ) : current && current.hasMarks ? (
            <Button kind="danger" testId="S-12.btn.deactivateStudent" onClick={() => act(() => api.deactivateStudent(current.id))}>
              Деактивировать
            </Button>
          ) : (
            <Button
              kind="danger"
              testId="S-12.btn.deleteStudent"
              disabled={!current}
              onClick={() => current && setConfirm({ kind: "student", student: current })}
            >
              Удалить ученика
            </Button>
          )}
          <Button kind="danger" testId="S-12.btn.deleteClass" onClick={() => setConfirm({ kind: "class" })}>
            Удалить класс
          </Button>
        </div>
      ) : null}

      {editing ? (
        <StudentModal
          classId={classId}
          student={editing === "new" ? null : editing}
          groupCount={cls.groupCount}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}

      {confirm ? (
        <ConfirmDelete
          cls={cls}
          confirm={confirm}
          onClose={() => setConfirm(null)}
          onDone={(msg) => {
            setConfirm(null);
            if (msg) showToast(msg);
            if (confirm.kind === "class") navigate("/classes");
            else reload();
          }}
        />
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

// ─────────────────────────── S-13 · профиль ученика (M-02) ───────────────────────────

function StudentModal({
  classId,
  student,
  groupCount,
  onClose,
  onSaved,
}: {
  classId: string;
  student: StudentDto | null;
  groupCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    lastName: student?.lastName ?? "",
    firstName: student?.firstName ?? "",
    middleName: student?.middleName ?? "",
    sex: student?.sex ?? ("" as "" | "m" | "f"),
    groupNo: student?.groupNo ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = form.lastName.trim() && form.firstName.trim() && form.sex !== "";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const dto = {
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        sex: form.sex as "m" | "f",
        groupNo: form.groupNo,
      };
      if (student) await api.updateStudent(student.id, dto);
      else await api.addStudent(classId, dto);
      onSaved();
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={student ? "Профиль ученика" : "Новый ученик"}
      width={480}
      onClose={onClose}
      testId="M-02"
        mobile="fullscreen"
      footer={
        <div className="sch-actions">
          <Button kind="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button kind="primary" testId="S-13.btn.save" disabled={!ready} loading={busy} onClick={save}>
            Сохранить
          </Button>
        </div>
      }
    >
      <Field
        label="Фамилия"
        testId="S-13.input.lastName"
        value={form.lastName}
        autoCapitalize="words"
        onChange={(e) => setForm({ ...form, lastName: e.target.value })}
      />
      <Field
        label="Имя"
        testId="S-13.input.firstName"
        value={form.firstName}
        autoCapitalize="words"
        onChange={(e) => setForm({ ...form, firstName: e.target.value })}
      />
      <Field
        label="Отчество"
        hint="при наличии"
        testId="S-13.input.middleName"
        value={form.middleName}
        autoCapitalize="words"
        onChange={(e) => setForm({ ...form, middleName: e.target.value })}
      />
      <div className="sch-field">
        <span className="sch-field-label">Пол</span>
        {/* Обязательное поле: из него берётся заливка строки (`S-13.radio.sex`). */}
        <div className="sch-radio" data-testid="S-13.radio.sex">
          <label>
            <input type="radio" name="sex" value="m" checked={form.sex === "m"} onChange={() => setForm({ ...form, sex: "m" })} />
            Мальчик
          </label>
          <label>
            <input type="radio" name="sex" value="f" checked={form.sex === "f"} onChange={() => setForm({ ...form, sex: "f" })} />
            Девочка
          </label>
        </div>
      </div>
      {groupCount > 0 ? (
        <div className="sch-field">
          <span className="sch-field-label">Группа</span>
          <select
            className="sch-input"
            data-testid="S-13.select.group"
            value={form.groupNo ?? ""}
            onChange={(e) => setForm({ ...form, groupNo: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">по разбиению</option>
            {Array.from({ length: groupCount }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Группа {i + 1}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {error ? (
        <p className="sch-danger-text" role="alert">
          {error}
        </p>
      ) : null}
      {/* Доступ ученика 1.2.0 (AR-155): вход опционален — записи, журнал и
          дневник через устройство родителя работают и без него. */}
      {student ? <StudentAccessBlock student={student} /> : null}
    </Modal>
  );
}

// ─────────────── S-13 · доступ ученика (AR-155, AR-161) ───────────────

function StudentAccessBlock({ student }: { student: StudentDto }) {
  const { can } = useSession();
  const [access, setAccess] = useState<StudentAccessDto | null>(null);
  const [creds, setCreds] = useState<CredentialsDto | null>(null);
  const [qr, setQr] = useState<{ token: string; fullName: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mayManage = can("contingent.write");

  useEffect(() => {
    api
      .studentAccess(student.id)
      .then(setAccess)
      .catch(() => setAccess(null));
  }, [student.id]);

  usePolling(
    async () => {
      const r = await api.studentActivationStatus(student.id).catch(() => null);
      if (r?.registeredName) {
        setQr(null);
        setAccess(await api.studentAccess(student.id).catch(() => access));
      }
    },
    ACCESS_PARAMS.pollIntervalMs,
    Boolean(qr),
  );

  if (!mayManage || access === null) return null;

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof SchoolApiError ? e.message : "Не получилось");
    }
  };

  return (
    <div className="sch-stack" data-testid="S-13.access" style={{ marginTop: "var(--sp-16)" }}>
      <h3 style={{ marginBottom: 0 }}>Доступ ученика</h3>
      {!access.hasAccount ? (
        <div className="sch-actions sch-actions--start">
          <Button
            kind="secondary"
            testId="S-13.btn.createAccess"
            onClick={() =>
              run(async () => {
                const r = await api.createStudentAccess(student.id, {});
                setAccess(r.access);
                setCreds(r.credentials);
              })
            }
          >
            Завести доступ
          </Button>
          <span className="sch-muted">юзернейм и пароль создадутся сами</span>
        </div>
      ) : (
        <>
          <p style={{ margin: 0 }} data-testid="S-13.access.status">
            @{access.username} · {access.activated ? "авторизован" : "не авторизован"}
          </p>
          <div className="sch-actions sch-actions--start">
            {!access.activated ? (
              <Button
                kind="primary"
                testId="S-13.btn.qr"
                onClick={() =>
                  run(async () => {
                    const t = await api.studentActivationToken(student.id);
                    setQr({ token: t.token, fullName: t.fullName ?? null });
                  })
                }
              >
                QR для входа
              </Button>
            ) : (
              <Button
                kind="danger"
                testId="S-13.btn.revokeActivation"
                onClick={() =>
                  run(async () => {
                    setAccess(await api.revokeStudentActivation(student.id));
                    setQr(null);
                  })
                }
              >
                Отозвать активацию
              </Button>
            )}
            <Button
              kind="ghost"
              testId="S-13.btn.reissuePassword"
              onClick={() => run(async () => setCreds(await api.studentCredentials(student.id)))}
            >
              Перевыпустить пароль
            </Button>
          </div>
        </>
      )}
      {qr ? (
        <div className="sch-qr" data-testid="S-13.qr">
          {/* Именной QR (AR-161): над кодом — ФИО, сканирует названный ученик. */}
          <h3 style={{ margin: 0 }}>{qr.fullName}</h3>
          <div className="sch-qr-frame">
            <QRCodeSVG value={`${window.location.origin}/join/${qr.token}`} size={200} />
          </div>
          <p className="sch-muted">Код живёт {ACCESS_PARAMS.activationTtlMinutes} минут</p>
        </div>
      ) : null}
      {creds ? <CredentialsBox credentials={creds} /> : null}
      {err ? (
        <p className="sch-danger-text" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────── M-13 · подтверждение удаления ───────────────────────────

function ConfirmDelete({
  cls,
  confirm,
  onClose,
  onDone,
}: {
  cls: ClassDto;
  confirm: { kind: "class" } | { kind: "student"; student: StudentDto };
  onClose: () => void;
  onDone: (msg?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Текст называет ДЕЙСТВИТЕЛЬНЫЙ объём потери (AR-105): формулировка «пустых
  // профилей» допустима ровно тогда, когда `filledProfiles === 0`.
  const dangerous = confirm.kind === "class" && cls.filledProfiles > 0;
  const text =
    confirm.kind === "class"
      ? cls.filledProfiles > 0
        ? `Удалить ${cls.label}? Заполнено ${cls.filledProfiles} профилей из ${cls.totalProfiles} — они будут удалены`
        : `Удалить ${cls.label}? ${cls.totalProfiles} пустых профилей будут удалены`
      : `Удалить ученика ${confirm.student.lastName} ${confirm.student.firstName}? Обратной операции нет`;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (confirm.kind === "class") {
        const r = await api.deleteClass(cls.id);
        onDone(`Класс удалён вместе с ${r.studentsDeleted} профилями`);
      } else {
        await api.deleteStudent(confirm.student.id);
        onDone();
      }
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не удалось удалить");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Подтверждение удаления"
      width={400}
      onClose={onClose}
      testId="M-13"
        mobile="sheet"
      footer={
        <div className="sch-actions">
          <Button kind="ghost" onClick={onClose}>
            Отмена
          </Button>
          {/* `B-danger` при необратимой операции с заполненными данными (§3). */}
          <Button kind={dangerous ? "danger" : "primary"} loading={busy} onClick={run} testId="M-13.confirm">
            Удалить
          </Button>
        </div>
      }
    >
      <p>{text}</p>
      {error ? (
        <p className="sch-danger-text" role="alert" style={{ marginTop: "var(--sp-12)" }}>
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
