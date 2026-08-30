/**
 * Предметы: `S-20` сетка карточек, `M-03` создание, `S-21` карточка предмета
 * (`M-04`), `S-22` QR привязки педагога (`M-05` — ВТОРОЙ и последний уровень
 * вложенности, AR-82).
 *
 * Карточка заводится на ПАРУ «предмет × класс»: математика-5 и математика-6 —
 * две карточки. «Весь класс» и групповые привязки одного предмета
 * взаимоисключаемы (Д6). Ожидание скана — поллинг раз в 2 секунды (AR-87).
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ACCESS_PARAMS, type ClassDto, type SubjectDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, usePolling } from "../hooks";
import { Avatar, Button, EmptyState, ErrorState, Field, Modal, Skeletons, Toast, useToast } from "../ui";
import { useSession } from "../session";
import { navigate } from "../router";

export function SubjectsScreen({ openId }: { openId?: string }) {
  const { can } = useSession();
  const [state, reload] = useAsync(async () => {
    const [subjects, classes] = await Promise.all([api.subjects(), api.classes()]);
    return { subjects, classes: classes.classes };
  });
  const [creating, setCreating] = useState(false);
  const { toast, showToast } = useToast();
  const mayWrite = can("subject.write");

  if (state.status === "loading") return <Skeletons count={6} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const { subjects, classes } = state.data;
  const open = openId ? subjects.find((s) => s.id === openId) ?? null : null;

  return (
    <>
      <div className="sch-page-head">
        <h1>Предметы</h1>
        {mayWrite ? (
          <div className="sch-actions">
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
        <div className="sch-cards--3" data-testid="S-20.grid.subjects">
          {subjects.map((s) => (
            <SubjectCard key={s.id} subject={s} />
          ))}
        </div>
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

      {open ? <SubjectCardModal subject={open} onClose={() => navigate("/subjects")} onChanged={reload} /> : null}
      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

function SubjectCard({ subject }: { subject: SubjectDto }) {
  return (
    <button
      className="sch-card sch-card--clickable"
      data-testid="S-20.card.subject"
      data-subject-id={subject.id}
      onClick={() => navigate(`/subjects/${subject.id}`)}
    >
      <div className="sch-row sch-row--between">
        <div>
          <div className="sch-card-title">{subject.name}</div>
          <div className="sch-card-sub">{subject.classLabel} класс</div>
        </div>
        <div className="sch-inline-avatars">
          {subject.bindings.map((b) => (
            <Avatar key={b.id} name={b.teacherName} url={b.avatarUrl} />
          ))}
        </div>
      </div>
      <div className="sch-chips" style={{ marginTop: "var(--sp-12)" }}>
        {subject.coverageComplete ? (
          <span className="sch-btn sch-btn--chip" data-testid="S-20.card.subject.badge">
            весь класс
          </span>
        ) : subject.uncoveredGroups.length > 0 ? (
          subject.uncoveredGroups.map((g) => (
            <span key={g} className="sch-btn sch-btn--chip" data-warning="true" data-testid="S-20.card.subject.badge">
              группа {g} — нет педагога
            </span>
          ))
        ) : (
          /* Покрытие неполное, а групп в перечне нет — значит непокрыт весь
             класс: карточка только что заведена и педагога у неё ещё нет.
             Молчащая карточка в этом месте была бы худшим из вариантов. */
          <span className="sch-btn sch-btn--chip" data-warning="true" data-testid="S-20.card.subject.badge">
            весь класс — нет педагога
          </span>
        )}
      </div>
    </button>
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
            <Button kind="fab" testId="S-21.btn.bind" aria-label="Привязать педагога" onClick={() => setBind(true)}>
              +
            </Button>
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

      {toast ? <Toast text={toast} /> : null}
    </>
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
