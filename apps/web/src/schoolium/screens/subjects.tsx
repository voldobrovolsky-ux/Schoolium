/**
 * Предметы: `S-20` — ДВА вида одного реестра (правка владельца 2026-08-31):
 * «По дисциплинам» — карточка дисциплины со строчками классов («5А — Петрова
 * А. И.»), «По классам» — карточка класса со строчками предметов; при «По
 * классам» справа от фильтра раскрывается ряд чипов классов — мультивыбор,
 * карточки только у отмеченных (AR-208); сбоку алфавитный указатель. `M-03`
 * создание (дубль по ключу имени — `SUBJECT_EXISTS`, AR-201), `S-21` карточка
 * предмета (`M-04`), `S-22` QR привязки (`M-05`), `M-25` «Управление
 * компетенцией» (AR-179, AR-202): личный QR педагога → галочки позиций, в том
 * числе групповых → сохранение с заменой занятых через подтверждение (`M-26`).
 *
 * Карточка заводится на ПАРУ «предмет × класс». «Весь класс» и групповые
 * привязки взаимоисключаемы (Д6). Незаполненная позиция — фон `state.stale-bg`
 * и слово «нет педагога» (AR-208, AR-80). Ожидание скана — поллинг 2 с (AR-87).
 */
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ACCESS_PARAMS,
  type ClassDto,
  type CompetenceConflictDto,
  type SaveCompetenceDto,
  type SubjectDto,
} from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile, usePolling } from "../hooks";
import { Icon } from "../icons";
import { Avatar, Button, EmptyState, ErrorState, Field, Modal, Skeletons, Toast, useToast } from "../ui";
import { useSession } from "../session";
import { navigate } from "../router";
import { parseQr, QrCamera, CameraDenied } from "../qr";
import "./subjects.css";

/** «Фамилия И.» (AR-208): `displayName` хранится как «Фамилия Имя [Отчество]». */
const teacherShort = (name: string): string => {
  const [last = "", first] = name.trim().split(/\s+/);
  return first ? `${last} ${first[0]}.` : last;
};
/** «Фамилия И. О.» — классовая строка позиции (реестр `S-20`). */
const teacherInitials = (name: string): string => {
  const [last = "", ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${last} ${rest.map((w) => `${w[0]}.`).join(" ")}` : last;
};
/** Подпись класса: «5А» либо «5 класс» — голая цифра без литеры не читается. */
const classTitle = (label: string): string => (/^\d+$/.test(label) ? `${label} класс` : label);
/** Номера групп класса 1..N. */
const groupsOf = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

/**
 * Педагоги строки позиции (AR-208): классовая — «— Петрова А. И.»; групповая —
 * «· 1 группа — Петрова А., 2 группа — Хохлова Б.» (в карточке класса
 * разделитель «—»). Непокрытые группы называет бейдж, а не строка.
 */
const positionText = (s: SubjectDto, groupSep: string): string | null => {
  const cls = s.bindings.filter((b) => b.scope === "class");
  if (cls.length) return `— ${cls.map((b) => teacherInitials(b.teacherName)).join(", ")}`;
  const byGroup = new Map<number, string>();
  for (const b of s.bindings) if (b.scope === "group") for (const g of b.groupNos) byGroup.set(g, teacherShort(b.teacherName));
  if (byGroup.size === 0) return null;
  const parts = [...byGroup.entries()].sort(([a], [b]) => a - b).map(([g, t]) => `${g} группа — ${t}`);
  return `${groupSep} ${parts.join(", ")}`;
};

const letterOf = (name: string): string => (name[0] ?? "•").toUpperCase();
/** Числовой порядок меток классов: «2» раньше «10», буквы литер — следом. */
const byLabel = (a: string, b: string): number => a.localeCompare(b, "ru", { numeric: true });

/**
 * Алфавитный указатель сбоку (правка владельца 2026-08-31: «листать по экрану
 * вообще не в кайф»): тап по букве подкручивает к первой карточке на неё.
 * Ищет якоря `data-alpha` в своей области — на экране это контент, в модалке
 * компетенций её тело.
 */
function AlphaIndex({
  letters,
  scopeRef,
  testId,
}: {
  letters: string[];
  scopeRef?: React.RefObject<HTMLElement | null>;
  testId?: string;
}) {
  if (letters.length < 2) return null;
  return (
    <nav className="sch-alpha" data-testid={testId} aria-label="Указатель по алфавиту">
      {letters.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() =>
            (scopeRef?.current ?? document)
              .querySelector(`[data-alpha="${l}"]`)
              ?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
        >
          {l}
        </button>
      ))}
    </nav>
  );
}

/**
 * Строка позиции «предмет × класс» — вход в карточку `S-21`. Незаполненная
 * (без привязок либо с неполным покрытием) — `data-unfilled` и фон
 * `state.stale-bg`; слово «нет педагога» остаётся (AR-208, AR-80).
 */
function SubjectRow({ subject, label, groupSep }: { subject: SubjectDto; label: string; groupSep: "·" | "—" }) {
  const unfilled = subject.bindings.length === 0 || !subject.coverageComplete;
  const text = positionText(subject, groupSep);
  return (
    <button
      type="button"
      className="sch-subject-row"
      data-testid="S-20.card.subject"
      data-subject-id={subject.id}
      data-unfilled={unfilled ? "true" : undefined}
      onClick={() => navigate(`/subjects/${subject.id}`)}
    >
      <span className="sch-subject-row-label">{label}</span>
      {text ? <span className="sch-muted">{text}</span> : null}
      {subject.bindings.length === 0 ? (
        <span className="sch-warning-text" data-testid="S-20.card.subject.badge">
          нет педагога
        </span>
      ) : null}
      {subject.bindings.length > 0 && !subject.coverageComplete ? (
        <span className="sch-warning-text" data-testid="S-20.card.subject.badge">
          группа {subject.uncoveredGroups.join(", ")} — нет педагога
        </span>
      ) : null}
    </button>
  );
}

export function SubjectsScreen({ openId, competenceId }: { openId?: string; competenceId?: string | null }) {
  const { can } = useSession();
  const [state, reload, patch] = useAsync(async () => {
    const [subjects, classes] = await Promise.all([api.subjects(), api.classes()]);
    return { subjects, classes: classes.classes, contingentVersion: classes.version };
  });
  // Тихое перечитывание под открытой `M-25` (AR-202): после деления класса
  // нужны новые `groupCount` и версия контингента, а скелетоны `reload`
  // размонтировали бы модалку вместе с невысланными галочками.
  const refresh = async () => {
    const [subjects, classes] = await Promise.all([api.subjects(), api.classes()]);
    patch({ subjects, classes: classes.classes, contingentVersion: classes.version });
  };
  const [creating, setCreating] = useState(false);
  // false — закрыто; null — открыто без педагога (скан/выбор); строка — педагог из личного QR
  const [competence, setCompetence] = useState<string | null | false>(competenceId ?? false);
  const [view, setView] = useState<"subject" | "class">("subject");
  // Фильтр классов (AR-208): хранятся СНЯТЫЕ — по умолчанию отмечены все, и
  // класс, появившийся после перечитывания, отмечен тоже.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  // Ряд чипов классов монтируется свёрнутым и раскрывается следующим кадром —
  // иначе переходу max-width/opacity нечего анимировать; сворачивание ждёт
  // конца перехода (150 мс) и только потом убирает ряд из DOM.
  const [chipsMounted, setChipsMounted] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(false);
  const ribbonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view === "class") {
      setChipsMounted(true);
      return;
    }
    setChipsOpen(false);
    const t = setTimeout(() => setChipsMounted(false), 160);
    return () => clearTimeout(t);
  }, [view]);
  useEffect(() => {
    if (!chipsMounted || view !== "class") return;
    // Свёрнутое состояние обязано попасть в расчёт стилей ДО раскрытия —
    // чтение геометрии форсирует его; затем кадр — и переход идёт.
    void ribbonRef.current?.getBoundingClientRect();
    const raf = requestAnimationFrame(() => setChipsOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [chipsMounted, view]);
  const { toast, showToast } = useToast();
  const mayWrite = can("subject.write");

  if (state.status === "loading") return <Skeletons count={6} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const { subjects, classes, contingentVersion } = state.data;
  const open = openId ? subjects.find((s) => s.id === openId) ?? null : null;

  // ── группировки двух видов ──
  const names = [...new Set(subjects.map((s) => s.name))].sort((a, b) => a.localeCompare(b, "ru"));
  const byName = (n: string) => subjects.filter((s) => s.name === n).sort((a, b) => byLabel(a.classLabel, b.classLabel));
  const classList = classes
    .filter((c) => subjects.some((s) => s.classId === c.id))
    .sort((a, b) => byLabel(a.label, b.label));
  const selectedClasses = classList.filter((c) => !deselected.has(c.id));
  const toggleClass = (id: string) =>
    setDeselected((d) => {
      const next = new Set(d);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const byClass = (id: string) => subjects.filter((s) => s.classId === id).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const letters = [...new Set(names.map(letterOf))];

  return (
    <>
      <div className="sch-page-head">
        <h1>Предметы</h1>
        {mayWrite ? (
          <div className="sch-actions">
            {/* Управление компетенцией (AR-179): скан личного QR педагога →
                галочки позиций. Один заход вместо QR на каждую карточку. */}
            {subjects.length > 0 ? (
              <Button kind="secondary" testId="S-20.btn.competence" onClick={() => setCompetence(null)}>
                Управление компетенцией
              </Button>
            ) : null}
            {/* S-23 · пресет (AR-160): типовые предметы × классы, идемпотентно. */}
            <Button
              kind="secondary"
              testId="S-23.btn.preset"
              onClick={async () => {
                try {
                  const r = await api.subjectsPreset();
                  showToast(r.created > 0 ? `Создано карточек: ${r.created}` : "Все типовые предметы уже заведены");
                  reload();
                } catch (e) {
                  showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
                }
              }}
            >
              Типовые предметы
            </Button>
            {subjects.length > 0 ? (
              <Button kind="primary" testId="S-20.btn.newSubject" onClick={() => setCreating(true)}>
                Создать предмет
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {subjects.length === 0 ? (
        <EmptyState
          icon="subjects"
          testId="S-20.empty"
          title="Предметов пока нет"
          hint={mayWrite ? "Создайте предметы — к ним привяжете педагогов" : "Предметы появятся, когда модератор их создаст"}
          action={
            mayWrite ? (
              <Button kind="primary" testId="S-20.btn.newSubject" onClick={() => setCreating(true)}>
                Создать предмет
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Фильтр вида (правка владельца 2026-08-31): дисциплина со строчками
              классов ЛИБО класс со строчками предметов — не плоский список. */}
          <div className="sch-s20-head">
            <div className="sch-chips" data-testid="S-20.view">
              <Button kind="chip" aria-pressed={view === "subject"} onClick={() => setView("subject")}>
                По дисциплинам
              </Button>
              <Button kind="chip" aria-pressed={view === "class"} onClick={() => setView("class")}>
                По классам
              </Button>
            </div>
            {/* Ряд чипов классов (AR-208): раскрывается справа при «По классам»,
                сворачивается при «По дисциплинам»; мультивыбор, по умолчанию все. */}
            {chipsMounted ? (
              <div
                ref={ribbonRef}
                className="sch-chips sch-s20-classes sch-unfold-x"
                data-testid="S-20.chips.classes"
                data-open={chipsOpen ? "true" : "false"}
                role="group"
                aria-label="Классы"
              >
                {classList.map((c) => (
                  <Button
                    key={c.id}
                    kind="chip"
                    testId="S-20.chip.class"
                    aria-pressed={!deselected.has(c.id)}
                    data-class-id={c.id}
                    onClick={() => toggleClass(c.id)}
                  >
                    {classTitle(c.label)}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          {view === "subject" ? (
            <>
              <div className="sch-stack" data-testid="S-20.grid.subjects">
                {names.map((n, i) => (
                  <section
                    key={n}
                    className="sch-card sch-stack"
                    style={{ gap: "var(--sp-8)" }}
                    data-testid="S-20.group.subject"
                    data-alpha={i === 0 || letterOf(names[i - 1]) !== letterOf(n) ? letterOf(n) : undefined}
                  >
                    <h3 className="sch-card-title">{n}</h3>
                    <div className="sch-list">
                      {byName(n).map((s) => (
                        <SubjectRow key={s.id} subject={s} label={classTitle(s.classLabel)} groupSep="·" />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <AlphaIndex letters={letters} testId="S-20.index" />
            </>
          ) : (
            <div className="sch-stack" data-testid="S-20.grid.subjects">
              {/* Карточка класса — только у отмеченных в ряду чипов (AR-208). */}
              {selectedClasses.map((c) => (
                <section key={c.id} className="sch-card sch-stack" style={{ gap: "var(--sp-8)" }} data-testid="S-20.group.class">
                  <h3 className="sch-card-title">{classTitle(c.label)}</h3>
                  <div className="sch-list">
                    {byClass(c.id).map((s) => (
                      <SubjectRow key={s.id} subject={s} label={s.name} groupSep="—" />
                    ))}
                  </div>
                </section>
              ))}
              {selectedClasses.length === 0 ? (
                <p className="sch-muted">Все классы сняты в фильтре — отметьте хотя бы один, и его предметы появятся здесь</p>
              ) : null}
            </div>
          )}
        </>
      )}

      {creating ? (
        <CreateSubject
          classes={classes}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}

      {competence !== false ? (
        <CompetenceModal
          subjects={subjects}
          contingentVersion={contingentVersion}
          preselect={competence}
          onRefresh={refresh}
          onClose={() => {
            setCompetence(false);
            if (competenceId) navigate("/subjects");
          }}
          onChanged={reload}
        />
      ) : null}

      {open ? <SubjectCardModal subject={open} onClose={() => navigate("/subjects")} onChanged={reload} /> : null}
      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

// ─────────────────────────── M-03 · создание предмета ───────────────────────────

function CreateSubject({ classes, onClose, onDone }: { classes: ClassDto[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Дубль по ключу имени (AR-201) — под полем имени, а не общим текстом:
  // человек правит именно это поле.
  const [nameError, setNameError] = useState<string | null>(null);

  return (
    <Modal
      title="Создание предмета"
      width={480}
      onClose={onClose}
      testId="M-03"
        mobile="fullscreen"
      footer={
        <div className="sch-actions">
          <Button kind="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            kind="primary"
            testId="M-03.create"
            disabled={!name.trim() || !classId}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.createSubject({ name: name.trim(), classId });
                onDone();
              } catch (e) {
                if (e instanceof SchoolApiError && e.code === "SUBJECT_EXISTS") setNameError(e.message);
                else setError(e instanceof SchoolApiError ? e.message : "Не удалось создать");
                setBusy(false);
              }
            }}
          >
            Создать
          </Button>
        </div>
      }
    >
      <Field
        label="Название"
        testId="M-03.input.name"
        value={name}
        error={nameError}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(null);
        }}
      />
      <div className="sch-field">
        <span className="sch-field-label">Класс</span>
        <select className="sch-input" data-testid="M-03.select.class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.letter ? c.label : `${c.label} класс`}
            </option>
          ))}
        </select>
      </div>
      <p className="sch-muted">
        Карточка заводится на пару «предмет × класс»: математика-5 и математика-6 — две карточки. Имя сравнивается
        без учёта регистра: «алгебра» и «Алгебра» — одна карточка.
      </p>
      {error ? (
        <p className="sch-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

// ─────────────────────────── S-21 · карточка предмета (M-04) ───────────────────────────

function SubjectCardModal({ subject, onClose, onChanged }: { subject: SubjectDto; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const [current, setCurrent] = useState(subject);
  const [bind, setBind] = useState(false);
  const [bindManual, setBindManual] = useState(false);
  const { toast, showToast } = useToast();
  const mayWrite = can("subject.write");

  const act = async (fn: () => Promise<SubjectDto | { ok: boolean }>) => {
    try {
      const r = await fn();
      if ("id" in r) setCurrent(r as SubjectDto);
      onChanged();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    }
  };

  return (
    <>
      <Modal
        title={`${current.name} · ${current.classLabel} класс`}
        width={560}
        onClose={onClose}
        testId="M-04"
        mobile="fullscreen"
        footer={
          mayWrite ? (
            <div className="sch-actions sch-actions--start">
              <Button
                kind="danger"
                testId="S-21.btn.deleteSubject"
                disabled={current.bindings.length > 0}
                onClick={async () => {
                  try {
                    await api.deleteSubject(current.id);
                    onChanged();
                    onClose();
                  } catch (e) {
                    showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
                  }
                }}
              >
                Удалить предмет
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="sch-row sch-row--between">
          <span
            className={current.coverageComplete ? "sch-success-text" : "sch-warning-text"}
            data-testid="S-21.status.coverage"
          >
            {current.coverageComplete
              ? "Покрытие полное"
              : current.uncoveredGroups.length > 0
                ? `Группа ${current.uncoveredGroups.join(", ")} без педагога`
                : "Весь класс без педагога"}
          </span>
          {/* «+» — accent-кнопка, единственная розовая на этом слое. */}
          {mayWrite && !current.coverageComplete ? (
            <span className="sch-row" style={{ gap: "var(--sp-8)" }}>
              {/* Ручная привязка (AR-177): QR — основной канал, ручная — запасной. */}
              <Button kind="secondary" testId="S-21.btn.bindManual" onClick={() => setBindManual(true)}>
                Вручную
              </Button>
              <Button kind="fab" testId="S-21.btn.bind" aria-label="Привязать педагога" onClick={() => setBind(true)}>
                <Icon name="plus" />
              </Button>
            </span>
          ) : null}
        </div>

        <div className="sch-list" data-testid="S-21.list.bindings" style={{ marginTop: "var(--sp-16)" }}>
          {current.bindings.map((b) => (
            <div className="sch-row sch-row--between" key={b.id}>
              <span className="sch-row">
                <Avatar name={b.teacherName} url={b.avatarUrl} />
                <span>
                  {b.teacherName}
                  <br />
                  <span className="sch-muted">{b.scope === "class" ? "весь класс" : `группа ${b.groupNos.join(", ")}`}</span>
                </span>
              </span>
              {mayWrite ? (
                <Button kind="danger" testId="S-21.btn.unbind" onClick={() => act(() => api.unbindTeacher(current.id, b.teacherId))}>
                  Открепить
                </Button>
              ) : null}
            </div>
          ))}
          {current.bindings.length === 0 ? <p className="sch-muted">Педагог не привязан</p> : null}
        </div>
      </Modal>

      {/* M-05 — QR привязки: второй и ПОСЛЕДНИЙ уровень вложенности (AR-82). */}
      {bind ? (
        <BindQr
          subject={current}
          onClose={() => setBind(false)}
          onBound={(s) => {
            setCurrent(s);
            setBind(false);
            onChanged();
          }}
        />
      ) : null}

      {/* M-23 — ручная привязка (AR-177): тот же второй уровень, что M-05. */}
      {bindManual ? (
        <BindManual
          subject={current}
          onClose={() => setBindManual(false)}
          onBound={(s) => {
            setCurrent(s);
            setBindManual(false);
            onChanged();
          }}
        />
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

// ─────────────────── ручная привязка педагога (M-23, AR-177) ───────────────────

/**
 * Ручная привязка из карточки предмета: педагог из персонала, «весь класс»
 * либо непокрытые группы. QR остаётся основным каналом — эта модалка для
 * онбординга, когда телефона педагога под рукой нет. Второй уровень
 * вложенности — тот же, что у QR-слоя `M-05` (AR-82).
 */
function BindManual({ subject, onClose, onBound }: { subject: SubjectDto; onClose: () => void; onBound: (s: SubjectDto) => void }) {
  const [staff] = useAsync(() => api.staff());
  const teachers =
    staff.status === "ready"
      ? staff.data.filter((c) => c.filled && c.userId && !c.deactivated && c.roles.includes("teacher"))
      : [];
  const [teacherId, setTeacherId] = useState("");
  const cur = teachers.some((t) => t.userId === teacherId) ? teacherId : (teachers[0]?.userId ?? "");

  const hasGroupBindings = subject.bindings.some((b) => b.scope === "group");
  const groups = subject.uncoveredGroups;
  const [scope, setScope] = useState<"class" | "group">(hasGroupBindings ? "group" : "class");
  const [groupNos, setGroupNos] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = cur && (scope === "class" || groupNos.length > 0);

  return (
    <Modal
      title="Привязать вручную"
      width={420}
      onClose={onClose}
      testId="M-23"
      mobile="sheet"
      level={2}
      footer={
        <div className="sch-actions">
          <Button
            kind="primary"
            testId="S-21.btn.bindManualConfirm"
            disabled={!valid}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onBound(
                  await api.bindTeacherManual(subject.id, {
                    teacherId: cur,
                    scope,
                    groupNos: scope === "group" ? groupNos : undefined,
                  }),
                );
              } catch (e) {
                setError(e instanceof SchoolApiError ? e.message : "Не получилось");
              } finally {
                setBusy(false);
              }
            }}
          >
            Привязать
          </Button>
        </div>
      }
    >
      <div className="sch-stack">
        {staff.status === "loading" ? <Skeletons count={2} kind="row" /> : null}
        {staff.status === "ready" && teachers.length === 0 ? (
          <p className="sch-muted">Педагогов с заведённой учёткой пока нет — заведите их в «Персонале»</p>
        ) : null}
        {teachers.length > 0 ? (
          <div className="sch-field" data-testid="S-21.select.teacher">
            <span className="sch-field-label">Педагог</span>
            <select className="sch-input" value={cur} onChange={(e) => setTeacherId(e.target.value)}>
              {teachers.map((t) => (
                <option key={t.userId} value={t.userId!}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {groups.length > 0 || hasGroupBindings ? (
          <>
            <div className="sch-chips">
              <Button
                kind="chip"
                aria-pressed={scope === "class"}
                disabled={hasGroupBindings}
                onClick={() => setScope("class")}
              >
                Весь класс
              </Button>
              <Button kind="chip" aria-pressed={scope === "group"} onClick={() => setScope("group")}>
                Группа
              </Button>
            </div>
            {scope === "group" ? (
              <div className="sch-chips" data-testid="S-21.chips.groups">
                {groups.map((g) => (
                  <Button
                    kind="chip"
                    key={g}
                    aria-pressed={groupNos.includes(g)}
                    onClick={() => setGroupNos((c) => (c.includes(g) ? c.filter((x) => x !== g) : [...c, g]))}
                  >
                    группа {g}
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p className="sch-danger-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

// ─────────────────────────── S-22 · QR привязки педагога (M-05) ───────────────────────────

function BindQr({ subject, onClose, onBound }: { subject: SubjectDto; onClose: () => void; onBound: (s: SubjectDto) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"waiting" | "scanned" | "used" | "expired">("waiting");
  const [scanner, setScanner] = useState<string | null>(null);
  const [scope, setScope] = useState<"class" | "group" | null>(null);
  const [groups, setGroups] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groupCount = subject.uncoveredGroups.length ? Math.max(...subject.uncoveredGroups) : 0;

  const issue = () =>
    api
      .bindToken(subject.id)
      .then((t) => {
        setToken(t.token);
        setStatus("waiting");
      })
      .catch((e: unknown) => setError(e instanceof SchoolApiError ? e.message : "Не удалось выпустить код"));

  useEffect(() => {
    void issue();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  usePolling(
    async () => {
      const r = await api.bindStatus(subject.id).catch(() => null);
      if (!r) return;
      setStatus(r.status as typeof status);
      if (r.scannedByName) setScanner(r.scannedByName);
    },
    ACCESS_PARAMS.pollIntervalMs,
    status === "waiting",
  );

  const confirm = async () => {
    if (!token || !scope) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.bindTeacher(subject.id, { token, scope, groupNos: scope === "group" ? groups : undefined });
      onBound(s);
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не удалось привязать");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Привязка педагога"
      width={420}
      onClose={onClose}
      testId="M-05"
        mobile="sheet"
      level={2}
      footer={
        <div className="sch-actions">
          <Button kind="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            kind="primary"
            testId="S-22.btn.confirm"
            disabled={status !== "scanned" || !scope || (scope === "group" && groups.length === 0)}
            loading={busy}
            onClick={confirm}
          >
            Привязать
          </Button>
        </div>
      }
    >
      <div className="sch-qr">
        <div className="sch-qr-frame" data-testid="S-22.qr">
          {token ? (
            /* Ссылка своего origin (В1) — читается штатной камерой iPhone. */
            <QRCodeSVG value={`${window.location.origin}/bind/${token}`} size={240} />
          ) : (
            <div className="sch-skeleton sch-skeleton--qr" />
          )}
        </div>
        <p className="sch-muted" data-testid="S-22.caption">
          Одноразовый код · погаснет при закрытии карточки
        </p>
      </div>

      <div data-testid="S-22.scope" style={{ marginTop: "var(--sp-16)" }}>
        {status === "expired" ? (
          <div className="sch-stack">
            <p className="sch-danger-text">Код погас, откройте заново</p>
            <Button kind="secondary" onClick={issue}>
              Открыть заново
            </Button>
          </div>
        ) : status === "waiting" ? (
          <>
            <div className="sch-skeleton sch-skeleton--row" />
            <p className="sch-muted">Ожидание сканирования</p>
          </>
        ) : (
          <div className="sch-stack">
            <p>Сканировал: {scanner ?? "педагог"}</p>
            <div className="sch-chips">
              {/* Взаимоисключение: «Весь класс» гасит чипы групп и наоборот (Д6). */}
              <Button
                kind="chip"
                aria-pressed={scope === "class"}
                onClick={() => {
                  setScope("class");
                  setGroups([]);
                }}
              >
                Весь класс
              </Button>
              {Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => (
                <Button
                  key={g}
                  kind="chip"
                  aria-pressed={scope === "group" && groups.includes(g)}
                  onClick={() => {
                    setScope("group");
                    setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
                  }}
                >
                  Группа {g}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <p className="sch-danger-text" role="alert" style={{ marginTop: "var(--sp-12)" }}>
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

// ─────────────── M-25 · управление компетенцией (AR-179, AR-202) ───────────────

/** Строка `M-25` по карточке ДО сохранения: вид позиции, «весь класс», группы. */
interface RowState {
  mode: "class" | "group";
  cls: boolean;
  groups: number[];
}

/**
 * Стартовое состояние строки — из привязок выбранного педагога: своя групповая
 * привязка (или чужая при отсутствии своей классовой) открывает строку в виде
 * групп — класс и группы на одной карточке взаимоисключены (Д6).
 */
function rowFromBindings(s: SubjectDto, teacherId: string): RowState {
  const own = s.bindings.filter((b) => b.teacherId === teacherId);
  const cls = own.some((b) => b.scope === "class");
  const groups = [...new Set(own.filter((b) => b.scope === "group").flatMap((b) => b.groupNos))].sort((a, b) => a - b);
  const anyGroup = s.bindings.some((b) => b.scope === "group");
  return { mode: groups.length > 0 || (anyGroup && !cls) ? "group" : "class", cls, groups };
}

/**
 * Один заход вместо QR на каждую карточку: педагог выбирается сканом его
 * ЛИЧНОГО QR («Мой QR» в меню профиля) либо из списка персонала; дисциплины —
 * списком по названиям с указателем, раскрытие даёт строчки классов с
 * галочками. Галочка ставит «весь класс», снятая — открепляет; занятая другим
 * позиция уходит в подтверждение замены (`M-26`). Группы назначаются здесь же
 * (AR-202): чип «по группам» переводит строку на галочки групп, класс без
 * групп делится селектом сразу (`PUT /classes/:id/groups`, `contingent.write`).
 * Класс и группы на одной карточке взаимоисключены (Д6) — держит сервер.
 */
function CompetenceModal({
  subjects,
  contingentVersion,
  preselect,
  onClose,
  onChanged,
  onRefresh,
}: {
  subjects: SubjectDto[];
  /** Версия контингента для `PUT /classes/:id/groups` (CONCURRENT_EDIT, AR-109). */
  contingentVersion: number;
  preselect: string | null;
  onClose: () => void;
  onChanged: () => void;
  /** Тихое перечитывание карточек и версии — без размонтирования модалки. */
  onRefresh: () => Promise<void>;
}) {
  const mobile = useIsMobile();
  const { can } = useSession();
  const maySplit = can("contingent.write");
  const [staff] = useAsync(() => api.staff());
  const teachers =
    staff.status === "ready"
      ? staff.data.filter((c) => c.filled && c.userId && !c.deactivated && c.roles.includes("teacher"))
      : [];
  const [teacherId, setTeacherId] = useState(preselect ?? "");
  const cur = teachers.some((t) => t.userId === teacherId) ? teacherId : "";
  const [scanning, setScanning] = useState(false);
  const [denied, setDenied] = useState(false);
  const [rows, setRows] = useState<Map<string, RowState>>(new Map());
  const [busy, setBusy] = useState(false);
  /** Класс, деление которого сейчас летит на сервер. */
  const [splitting, setSplitting] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<CompetenceConflictDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Выбранный педагог предзаполняет строки СВОИМИ позициями: экран показывает
  // текущую компетенцию, а не пустоту. Зависимость — только педагог: карточки,
  // перечитанные после деления класса, не должны стирать невысланные галочки.
  useEffect(() => {
    setRows(new Map(cur ? subjects.map((s) => [s.id, rowFromBindings(s, cur)]) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  const rowOf = (s: SubjectDto): RowState => rows.get(s.id) ?? rowFromBindings(s, cur);
  const update = (s: SubjectDto, f: (r: RowState) => RowState) =>
    setRows((m) => {
      const next = new Map(m);
      next.set(s.id, f(m.get(s.id) ?? rowFromBindings(s, cur)));
      return next;
    });

  /**
   * Непокрытое в строке С УЧЁТОМ невысланных галочек: `null` — заполнена;
   * `[]` — класс без педагога; `[2]` — группы без педагога. Фон и слово (AR-208).
   */
  const missingOf = (s: SubjectDto, r: RowState): number[] | null => {
    const othersClass = s.bindings.some((b) => b.teacherId !== cur && b.scope === "class");
    if (othersClass || (r.mode === "class" && r.cls)) return null;
    if (s.groupCount === 0) return [];
    const covered = new Set(s.bindings.filter((b) => b.teacherId !== cur && b.scope === "group").flatMap((b) => b.groupNos));
    if (r.mode === "group") for (const g of r.groups) covered.add(g);
    const missing = groupsOf(s.groupCount).filter((g) => !covered.has(g));
    return missing.length ? missing : null;
  };
  /** Чужая привязка, занимающая группу: групповая по номеру либо классовая целиком. */
  const holderOf = (s: SubjectDto, g: number) =>
    s.bindings.find((b) => b.teacherId !== cur && (b.scope === "class" || b.groupNos.includes(g)));

  const names = [...new Set(subjects.map((s) => s.name))].sort((a, b) => a.localeCompare(b, "ru"));
  const byName = (n: string) =>
    subjects.filter((s) => s.name === n).sort((a, b) => byLabel(a.classLabel, b.classLabel));
  const letters = [...new Set(names.map(letterOf))];

  const save = async (replace: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // Позиции (AR-202): классовая — без `groupNos`, групповая — с номерами;
      // строка без галочек в позиции не попадает — сервер открепляет педагога.
      const positions: NonNullable<SaveCompetenceDto["positions"]> = [];
      for (const s of subjects) {
        const r = rowOf(s);
        if (r.mode === "group") {
          if (r.groups.length) positions.push({ subjectId: s.id, groupNos: r.groups });
        } else if (r.cls) positions.push({ subjectId: s.id });
      }
      const res = await api.saveCompetence({
        teacherId: cur,
        subjectIds: positions.filter((p) => !p.groupNos).map((p) => p.subjectId),
        positions,
        replace,
      });
      if (!res.ok && res.conflicts) {
        setConflicts(res.conflicts);
      } else {
        setConflicts(null);
        showToast("Компетенции сохранены");
        onChanged();
        onClose();
      }
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  /** Деление класса на группы — сразу (AR-202): тост, перечитать карточки. */
  const split = async (s: SubjectDto, groupCount: number) => {
    setSplitting(s.classId);
    setError(null);
    try {
      await api.setClassGroups(s.classId, { groupCount, version: contingentVersion });
      showToast(`${classTitle(s.classLabel)} разделён на ${groupCount} группы — ученики распределены`);
      await onRefresh();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setSplitting(null);
    }
  };

  return (
    <>
      <Modal
        title="Управление компетенцией"
        width={640}
        onClose={onClose}
        testId="M-25"
        mobile="fullscreen"
        footer={
          <div className="sch-actions">
            <Button kind="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button kind="primary" testId="M-25.btn.save" disabled={!cur} loading={busy} onClick={() => save(false)}>
              Сохранить
            </Button>
          </div>
        }
      >
        <div className="sch-stack" style={{ position: "relative" }} ref={bodyRef}>
          {scanning ? (
            denied ? (
              <CameraDenied testId="M-25.error.denied" />
            ) : (
              <>
                <QrCamera
                  testId="M-25.viewfinder"
                  hint="Наведите камеру на «Мой QR» из профиля педагога"
                  onDenied={() => setDenied(true)}
                  onCancel={() => setScanning(false)}
                  onCode={(raw) => {
                    const qr = parseQr(raw);
                    if (qr?.kind !== "teacher") return setError("Это не личный QR педагога");
                    const hit = teachers.find((t) => t.userId === qr.value);
                    if (!hit) return setError("Этот QR не от педагога вашей школы");
                    setTeacherId(qr.value);
                    setScanning(false);
                    setError(null);
                  }}
                />
                <Button kind="ghost" onClick={() => setScanning(false)}>
                  Отмена
                </Button>
              </>
            )
          ) : (
            <>
              {staff.status === "loading" ? <Skeletons count={2} kind="row" /> : null}
              {staff.status === "ready" && teachers.length === 0 ? (
                <p className="sch-muted">Педагогов с заведённой учёткой пока нет — заведите их в «Персонале»</p>
              ) : null}
              {teachers.length > 0 ? (
                /* Мобайл: кнопка §4 растягивается на всю ширину и в ряду
                   ужимала селект до пары букв — складываемся в колонку. */
                <div
                  className={mobile ? "sch-stack" : "sch-row"}
                  style={mobile ? { gap: "var(--sp-8)" } : { alignItems: "flex-end", gap: "var(--sp-8)" }}
                >
                  <div className="sch-field" style={{ flex: "1 1 auto" }} data-testid="M-25.select.teacher">
                    <span className="sch-field-label">Педагог</span>
                    <select className="sch-input" value={cur} onChange={(e) => setTeacherId(e.target.value)}>
                      <option value="">— выберите или сканируйте QR —</option>
                      {teachers.map((t) => (
                        <option key={t.userId} value={t.userId!}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Сканировать можно телефоном; десктоп объясняет это сам (S-70). */}
                  {mobile ? (
                    <Button kind="secondary" testId="M-25.btn.scan" onClick={() => setScanning(true)}>
                      Сканировать QR
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {cur ? (
                <div className="sch-stack" style={{ gap: "var(--sp-8)" }} data-testid="M-25.list.subjects">
                  {names.map((n, i) => (
                    <details
                      key={n}
                      className="sch-accordion"
                      data-testid="M-25.group.subject"
                      data-alpha={i === 0 || letterOf(names[i - 1]) !== letterOf(n) ? letterOf(n) : undefined}
                    >
                      <summary>{n}</summary>
                      <div className="sch-stack" style={{ gap: "var(--sp-4)" }}>
                        {byName(n).map((s) => {
                          const r = rowOf(s);
                          const inGroups = r.mode === "group";
                          const missing = missingOf(s, r);
                          const othersClass = s.bindings
                            .filter((b) => b.scope === "class" && b.teacherId !== cur)
                            .map((b) => b.teacherName);
                          return (
                            <div className="sch-m25-row" key={s.id} data-unfilled={missing ? "true" : undefined}>
                              <div className="sch-m25-row-main">
                                <label className="sch-check-row">
                                  <input
                                    type="checkbox"
                                    data-testid="M-25.check.position"
                                    disabled={inGroups}
                                    checked={!inGroups && r.cls}
                                    onChange={() => update(s, (x) => ({ ...x, cls: !x.cls }))}
                                  />
                                  <span>{classTitle(s.classLabel)}</span>
                                  {!inGroups && othersClass.length ? (
                                    <span className="sch-muted">ведёт {othersClass.join(", ")}</span>
                                  ) : null}
                                  {/* Слово рядом с фоном — цвет не единственный носитель смысла (AR-80). */}
                                  {missing ? (
                                    <span className="sch-warning-text">
                                      {missing.length > 0 && missing.length < s.groupCount
                                        ? `группа ${missing.join(", ")} — нет педагога`
                                        : "нет педагога"}
                                    </span>
                                  ) : null}
                                </label>
                                {/* Чип «по группам» (AR-202): строка переходит с «весь класс»
                                    на групповые позиции и обратно. */}
                                <Button
                                  kind="chip"
                                  testId="M-25.toggle.groups"
                                  aria-pressed={inGroups}
                                  onClick={() => update(s, (x) => ({ ...x, mode: x.mode === "group" ? "class" : "group" }))}
                                >
                                  по группам
                                </Button>
                              </div>
                              {inGroups ? (
                                s.groupCount > 0 ? (
                                  <div className="sch-m25-sub">
                                    {groupsOf(s.groupCount).map((g) => {
                                      const holder = holderOf(s, g);
                                      const mine = r.groups.includes(g);
                                      return (
                                        <label className="sch-check-row" key={g}>
                                          <input
                                            type="checkbox"
                                            data-testid="M-25.check.group"
                                            checked={mine}
                                            onChange={() =>
                                              update(s, (x) => ({
                                                ...x,
                                                groups: x.groups.includes(g)
                                                  ? x.groups.filter((v) => v !== g)
                                                  : [...x.groups, g].sort((a, b) => a - b),
                                              }))
                                            }
                                          />
                                          <span>{g} группа</span>
                                          {holder ? (
                                            <span className="sch-muted">
                                              — ведёт {teacherShort(holder.teacherName)}
                                              {holder.scope === "class" ? " (весь класс)" : ""}
                                            </span>
                                          ) : !mine ? (
                                            <span className="sch-muted">— свободна</span>
                                          ) : null}
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : maySplit ? (
                                  <div className="sch-m25-sub">
                                    {/* Класс без групп: деление — сразу, `PUT /classes/:id/groups`
                                        (AR-202); ученики раздаются дефолтным разбиением (AR-75). */}
                                    <select
                                      className="sch-input sch-m25-split"
                                      data-testid="M-25.select.groupCount"
                                      aria-label={`Разделить ${classTitle(s.classLabel)} на группы`}
                                      value=""
                                      disabled={splitting === s.classId}
                                      onChange={(e) => {
                                        const n = Number(e.target.value);
                                        if (n) void split(s, n);
                                      }}
                                    >
                                      <option value="">разделить на…</option>
                                      <option value="2">2 группы</option>
                                      <option value="3">3 группы</option>
                                      <option value="4">4 группы</option>
                                    </select>
                                  </div>
                                ) : (
                                  <p className="sch-muted sch-m25-sub">Класс не разделён на группы — деление доступно модератору</p>
                                )
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                  <AlphaIndex letters={letters} scopeRef={bodyRef} testId="M-25.index" />
                </div>
              ) : (
                <p className="sch-muted">Выберите педагога — появится список дисциплин с галочками по классам</p>
              )}
            </>
          )}
          {error ? (
            <p className="sch-danger-text" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* M-26 — подтверждение замены: занятые позиции называются пофамильно,
          групповой конфликт — с номером группы (AR-202). */}
      {conflicts ? (
        <Modal
          title="Заменить педагога?"
          width={480}
          level={2}
          mobile="sheet"
          testId="M-26"
          onClose={() => setConflicts(null)}
          footer={
            <div className="sch-actions">
              <Button kind="ghost" onClick={() => setConflicts(null)}>
                Отмена
              </Button>
              <Button kind="primary" testId="M-26.btn.replace" loading={busy} onClick={() => save(true)}>
                Заменить всех
              </Button>
            </div>
          }
        >
          <div className="sch-stack" data-testid="M-26.list.conflicts">
            {conflicts.map((c, i) => (
              <p key={i}>
                {c.subjectName} в {c.classLabels.length > 1 ? "классах" : "классе"} {c.classLabels.join(", ")}
                {c.groupNo ? ` (группа ${c.groupNo})` : ""} уже ведёт {c.teacherNames.join(", ")}
              </p>
            ))}
            <p>Заменить всех?</p>
          </div>
        </Modal>
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

/**
 * `/competence/:teacherId` — личный QR педагога открыт камерой телефона:
 * модератора ведём в «Управление компетенцией» с предвыбранным педагогом,
 * остальным — объяснение, а не 403.
 */
export function CompetenceLink({ teacherId }: { teacherId: string }) {
  const { can } = useSession();
  const may = can("subject.write");
  useEffect(() => {
    if (may) navigate(`/subjects?competence=${encodeURIComponent(teacherId)}`);
  }, [may, teacherId]);
  if (may) return null;
  return (
    <EmptyState
      icon="qr"
      testId="S-20.competence.denied"
      title="Это личный QR педагога"
      hint="Компетенции назначает модератор: он сканирует этот код и отмечает предметы галочками в «Предметах» → «Управление компетенцией»"
    />
  );
}
