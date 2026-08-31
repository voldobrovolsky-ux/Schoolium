/**
 * Предметы: `S-20` — ДВА вида одного реестра (правка владельца 2026-08-31):
 * «По дисциплинам» — карточка дисциплины со строчками классов («Английский
 * язык: 3 класс — учитель 1…»), «По классам» — карточка класса со строчками
 * предметов; сбоку алфавитный указатель. `M-03` создание, `S-21` карточка
 * предмета (`M-04`), `S-22` QR привязки (`M-05`), `M-25` «Управление
 * компетенцией» (AR-179): личный QR педагога → галочки позиций → сохранение
 * с заменой занятых через подтверждение (`M-26`).
 *
 * Карточка заводится на ПАРУ «предмет × класс». «Весь класс» и групповые
 * привязки взаимоисключаемы (Д6). Ожидание скана — поллинг 2 с (AR-87).
 */
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ACCESS_PARAMS,
  type ClassDto,
  type CompetenceConflictDto,
  type SubjectDto,
} from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile, usePolling } from "../hooks";
import { Avatar, Button, EmptyState, ErrorState, Field, Modal, Skeletons, Toast, useToast } from "../ui";
import { useSession } from "../session";
import { navigate } from "../router";
import { parseQr, QrCamera, CameraDenied } from "../qr";

/** Педагоги строки: «учитель 1 / учитель 2 (гр. 1)» — как в примере владельца. */
const teachersOf = (s: SubjectDto): string =>
  s.bindings
    .map((b) => (b.scope === "group" ? `${b.teacherName} (гр. ${b.groupNos.join(", ")})` : b.teacherName))
    .join(" / ");

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

/** Строка позиции «предмет × класс» — вход в карточку `S-21`. */
function SubjectRow({ subject, label }: { subject: SubjectDto; label: string }) {
  return (
    <button
      type="button"
      className="sch-subject-row"
      data-testid="S-20.card.subject"
      data-subject-id={subject.id}
      onClick={() => navigate(`/subjects/${subject.id}`)}
    >
      <span className="sch-subject-row-label">{label}</span>
      {subject.bindings.length > 0 ? (
        <span className="sch-muted">{teachersOf(subject)}</span>
      ) : (
        <span className="sch-warning-text" data-testid="S-20.card.subject.badge">
          нет педагога
        </span>
      )}
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
  const [state, reload] = useAsync(async () => {
    const [subjects, classes] = await Promise.all([api.subjects(), api.classes()]);
    return { subjects, classes: classes.classes };
  });
  const [creating, setCreating] = useState(false);
  // false — закрыто; null — открыто без педагога (скан/выбор); строка — педагог из личного QR
  const [competence, setCompetence] = useState<string | null | false>(competenceId ?? false);
  const [view, setView] = useState<"subject" | "class">("subject");
  const { toast, showToast } = useToast();
  const mayWrite = can("subject.write");

  if (state.status === "loading") return <Skeletons count={6} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const { subjects, classes } = state.data;
  const open = openId ? subjects.find((s) => s.id === openId) ?? null : null;

  // ── группировки двух видов ──
  const names = [...new Set(subjects.map((s) => s.name))].sort((a, b) => a.localeCompare(b, "ru"));
  const byName = (n: string) => subjects.filter((s) => s.name === n).sort((a, b) => byLabel(a.classLabel, b.classLabel));
  const classList = classes
    .filter((c) => subjects.some((s) => s.classId === c.id))
    .sort((a, b) => byLabel(a.label, b.label));
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
          <div className="sch-chips" data-testid="S-20.view" style={{ marginBottom: "var(--sp-16)" }}>
            <Button kind="chip" aria-pressed={view === "subject"} onClick={() => setView("subject")}>
              По дисциплинам
            </Button>
            <Button kind="chip" aria-pressed={view === "class"} onClick={() => setView("class")}>
              По классам
            </Button>
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
                        <SubjectRow key={s.id} subject={s} label={`${s.classLabel} класс`} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <AlphaIndex letters={letters} testId="S-20.index" />
            </>
          ) : (
            <div className="sch-stack" data-testid="S-20.grid.subjects">
              {classList.map((c) => (
                <section key={c.id} className="sch-card sch-stack" style={{ gap: "var(--sp-8)" }} data-testid="S-20.group.class">
                  <h3 className="sch-card-title">{c.letter ? c.label : `${c.label} класс`}</h3>
                  <div className="sch-list">
                    {byClass(c.id).map((s) => (
                      <SubjectRow key={s.id} subject={s} label={s.name} />
                    ))}
                  </div>
                </section>
              ))}
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
          preselect={competence}
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
                setError(e instanceof SchoolApiError ? e.message : "Не удалось создать");
                setBusy(false);
              }
            }}
          >
            Создать
          </Button>
        </div>
      }
    >
      <Field label="Название" testId="M-03.input.name" value={name} onChange={(e) => setName(e.target.value)} />
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
      <p className="sch-muted">Карточка заводится на пару «предмет × класс»: математика-5 и математика-6 — две карточки.</p>
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
                +
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

// ─────────────── M-25 · управление компетенцией (AR-179) ───────────────

/**
 * Один заход вместо QR на каждую карточку: педагог выбирается сканом его
 * ЛИЧНОГО QR («Мой QR» в меню профиля) либо из списка персонала; дисциплины —
 * списком по названиям с указателем, раскрытие даёт строчки классов с
 * галочками. Галочка ставит «весь класс», снятая — открепляет; занятая другим
 * позиция уходит в подтверждение замены (`M-26`). Позиции с групповыми
 * привязками отсюда не трогаются (Д6) — группы назначаются из карточки
 * предмета.
 */
function CompetenceModal({
  subjects,
  preselect,
  onClose,
  onChanged,
}: {
  subjects: SubjectDto[];
  preselect: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const mobile = useIsMobile();
  const [staff] = useAsync(() => api.staff());
  const teachers =
    staff.status === "ready"
      ? staff.data.filter((c) => c.filled && c.userId && !c.deactivated && c.roles.includes("teacher"))
      : [];
  const [teacherId, setTeacherId] = useState(preselect ?? "");
  const cur = teachers.some((t) => t.userId === teacherId) ? teacherId : "";
  const [scanning, setScanning] = useState(false);
  const [denied, setDenied] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<CompetenceConflictDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Выбранный педагог предзаполняет галочки СВОИМИ классными позициями:
  // экран показывает текущую компетенцию, а не пустоту.
  useEffect(() => {
    setChecked(
      new Set(
        cur
          ? subjects.filter((s) => s.bindings.some((b) => b.teacherId === cur && b.scope === "class")).map((s) => s.id)
          : [],
      ),
    );
  }, [cur, subjects]);

  const names = [...new Set(subjects.map((s) => s.name))].sort((a, b) => a.localeCompare(b, "ru"));
  const byName = (n: string) =>
    subjects.filter((s) => s.name === n).sort((a, b) => byLabel(a.classLabel, b.classLabel));
  const letters = [...new Set(names.map(letterOf))];

  const save = async (replace: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.saveCompetence({ teacherId: cur, subjectIds: [...checked], replace });
      if (!r.ok && r.conflicts) {
        setConflicts(r.conflicts);
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
                <div className="sch-row" style={{ alignItems: "flex-end", gap: "var(--sp-8)" }}>
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
                          const groupBound = s.bindings.some((b) => b.scope === "group");
                          const others = s.bindings
                            .filter((b) => b.scope === "class" && b.teacherId !== cur)
                            .map((b) => b.teacherName);
                          return (
                            <label className="sch-check-row" key={s.id}>
                              <input
                                type="checkbox"
                                data-testid="M-25.check.position"
                                disabled={groupBound}
                                checked={checked.has(s.id)}
                                onChange={() =>
                                  setChecked((c) => {
                                    const next = new Set(c);
                                    if (next.has(s.id)) next.delete(s.id);
                                    else next.add(s.id);
                                    return next;
                                  })
                                }
                              />
                              <span>{s.classLabel} класс</span>
                              {groupBound ? (
                                <span className="sch-muted">группы — из карточки предмета</span>
                              ) : others.length ? (
                                <span className="sch-muted">ведёт {others.join(", ")}</span>
                              ) : null}
                            </label>
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

      {/* M-26 — подтверждение замены: занятые позиции называются пофамильно. */}
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
                {c.subjectName} в {c.classLabels.length > 1 ? "классах" : "классе"} {c.classLabels.join(", ")} уже ведёт{" "}
                {c.teacherNames.join(", ")}
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
      testId="S-20.competence.denied"
      title="Это личный QR педагога"
      hint="Компетенции назначает модератор: он сканирует этот код и отмечает предметы галочками в «Предметах» → «Управление компетенцией»"
    />
  );
}
