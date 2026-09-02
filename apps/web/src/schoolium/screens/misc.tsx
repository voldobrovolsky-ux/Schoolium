/**
 * `S-60` кабинет модератора, `S-70` сканер QR, `S-80` устройства и сессии,
 * плюс 403-экран для тех, кто пришёл в кабинет модератора без права на него.
 *
 * Общее у трёх экранов одно: они говорят человеку правду о том, чего он не
 * может, и почему. Пустой страницы и молчаливого редиректа нет ни в одном
 * случае (`70-screens.md`, `S-60`).
 *
 * Словари канала входа и вида клиента (AR-187) живут здесь и отдаются
 * карточке сотрудника (`S-31`): у сессии одни и те же слова на всех экранах.
 */
import { useEffect, useRef, useState } from "react";
import { SCHOOL_STATE_LABELS, SESSION_CLIENT_LABELS, SESSION_VIA_LABELS, type AuditEntryDto, type SessionDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile } from "../hooks";
import { Badge, Button, EmptyState, ErrorState, LinkRow, Modal, Skeletons, StatusDot, Toast, useToast } from "../ui";
import { Icon, type IconName } from "../icons";
import { CameraDenied, hasCamera, parseQr, QrCamera } from "../qr";
import { useSession } from "../session";
import { navigate } from "../router";
import "./misc.css";

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Словари каналов входа, видов клиента и состояний — из общего контракта (П-5). */
export const VIA_LABELS = SESSION_VIA_LABELS;
export const CLIENT_KIND_LABELS = SESSION_CLIENT_LABELS;
const STATE_LABELS = SCHOOL_STATE_LABELS;

// ─────────────────────────── 403 · раздел не для этой роли ───────────────────────────

/**
 * Экраны общие, действия гейтятся (AR-69) — но кабинет модератора целиком
 * принадлежит модератору, и остальным здесь показывается причина, а не
 * пустота. Кнопка ведёт на стартовый экран РОЛИ (AR-95): у завуча это
 * сводка, у педагога журнал, у родителя дневник — «/journal» для всех врал бы.
 */
export function ForbiddenScreen() {
  const { state } = useSession();
  const home = state.status === "authed" ? state.me.startScreen : "/";
  return (
    <EmptyState
      testId="forbidden"
      title="Раздел доступен модератору школы"
      hint="Классы, предметы, персонал и расписание ведёт кабинет модератора. Сеть, устройства и доступ — кабинет администратора, сводка по школе — кабинет завуча. Ваш раздел открывается со стартового экрана."
      action={
        <Button kind="primary" onClick={() => navigate(home)}>
          На стартовый экран
        </Button>
      }
    />
  );
}

// ─────────────────────────── S-60 · кабинет модератора ───────────────────────────

const SECTIONS: { to: string; label: string; hint: string; icon: IconName }[] = [
  { to: "/classes", label: "Классы", hint: "контингент и профили учеников", icon: "users" },
  { to: "/subjects", label: "Предметы", hint: "карточки «предмет × класс» и привязки педагогов", icon: "subjects" },
  { to: "/staff", label: "Персонал", hint: "карточки сотрудников, роли, доступ", icon: "staff" },
  { to: "/guardians", label: "Родители", hint: "учётки родителей и связи с детьми", icon: "users" },
  { to: "/schedule", label: "Расписание", hint: "сетка недели и её пересборка", icon: "calendar" },
];

export function ModeratorScreen() {
  const { can } = useSession();
  const [state, reload] = useAsync(() => api.moderatorCabinet());

  if (!can("school.manage")) return <ForbiddenScreen />;
  if (state.status === "loading") return <Skeletons count={4} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const s = state.data.state;

  return (
    <>
      <div className="sch-page-head">
        <h1>Кабинет модератора</h1>
        {/* Тон кодирует смысл (AR-80): журнал ведётся — сделано, сетка
            устарела — ждёт человека, остальное — путь ещё идёт. */}
        <Badge tone={s === "ready" ? "success" : s === "stale" ? "warning" : "muted"}>{STATE_LABELS[s]}</Badge>
      </div>

      <div className="sch-cards--4" data-testid="S-60.nav">
        {SECTIONS.map((x) => (
          <button key={x.to} className="sch-card sch-card--link" onClick={() => navigate(x.to)}>
            <span className="sch-linkrow-icon" aria-hidden="true">
              <Icon name={x.icon} size={20} />
            </span>
            <span className="sch-card-title">{x.label}</span>
            <span className="sch-muted">{x.hint}</span>
          </button>
        ))}
      </div>

      {/* Соседние кабинеты (AR-186): администратор и завуч часто те же люди,
          что и модератор, — переход к своему второму кабинету стоит здесь, а
          не только в сайдбаре, которого на телефоне нет. */}
      {can("school.admin") || can("school.oversee") ? (
        <div className="sch-list--rows sch-s60-cabinets">
          {can("school.admin") ? (
            <LinkRow icon="shieldCheck" label="Администрирование" hint="сеть, устройства, доступ" onClick={() => navigate("/admin")} />
          ) : null}
          {can("school.oversee") ? (
            <LinkRow icon="checklist" label="Кабинет завуча" hint="сводка по школе" onClick={() => navigate("/deputy")} />
          ) : null}
        </div>
      ) : null}

      {/* S-32 · «Не авторизованные» (AR-161): рабочий экран события 30.08 —
          заведено, но не активировано; активация убирает строку сама. */}
      <PendingBlock />

      <h2 className="sch-section-title" style={{ marginTop: "var(--sp-32)" }}>
        Мои действия
      </h2>
      {/* Аудит — противовес полным правам (AR-88): модератор видит собственный
          след теми же словами, какими его увидит проверяющий. Фильтров в
          1.1.1 нет намеренно. */}
      <AuditList entries={state.data.audit} />
    </>
  );
}


// ─────────────────── S-32 · «Не авторизованные» (AR-161) ───────────────────

function PendingBlock() {
  const [state, reload] = useAsync(() => api.pendingActivations());
  if (state.status === "loading") return <Skeletons count={2} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const p = state.data;
  const total = p.staff.length + p.students.reduce((n, g) => n + g.items.length, 0) + p.guardians.length;

  return (
    <section data-testid="S-32.pending" style={{ marginTop: "var(--sp-32)" }}>
      <div className="sch-row sch-row--between">
        <h2 className="sch-section-title">Не авторизованные</h2>
        <Button kind="ghost" testId="S-32.btn.refresh" onClick={reload}>
          Обновить
        </Button>
      </div>
      {total === 0 ? (
        <EmptyState title="Все авторизованы" hint="Заведённые учётки активированы — новых ожидающих нет" />
      ) : (
        <div className="sch-stack">
          {p.staff.length > 0 ? (
            <div className="sch-card">
              <strong>Персонал ({p.staff.length})</strong>
              <div className="sch-chips" style={{ marginTop: "var(--sp-8)" }}>
                {p.staff.map((x) => (
                  <button key={x.cardId} className="sch-chip" data-testid="S-32.item.staff" onClick={() => navigate(`/staff/${x.cardId}`)}>
                    {x.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {p.students.map((g) => (
            <div key={g.classLabel} className="sch-card">
              <strong>
                {g.classLabel} класс ({g.items.length})
              </strong>
              <div className="sch-chips" style={{ marginTop: "var(--sp-8)" }}>
                {g.items.map((x) => (
                  <button
                    key={x.studentId}
                    className="sch-chip"
                    data-testid="S-32.item.student"
                    onClick={() => navigate(`/classes/${g.classId}/student/${x.studentId}`)}
                  >
                    {x.name}
                    {!x.hasAccount ? " · без доступа" : ""}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {p.guardians.length > 0 ? (
            <div className="sch-card">
              <strong>Родители ({p.guardians.length})</strong>
              <div className="sch-chips" style={{ marginTop: "var(--sp-8)" }}>
                {p.guardians.map((x) => (
                  <button key={x.cardId} className="sch-chip" data-testid="S-32.item.guardian" onClick={() => navigate(`/guardians/${x.cardId}`)}>
                    {x.name || "учётка не заведена"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AuditList({ entries }: { entries: AuditEntryDto[] }) {
  const mobile = useIsMobile();
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Действий пока нет"
        hint="Здесь появится журнал ваших действий: дата, действие, объект"
      />
    );
  }
  /* На мобайле аудит — карточки, а не таблица (§6): три колонки на 390px дают
     нечитаемый горизонтальный скролл там, где строка и так короткая. */
  if (mobile) {
    return (
      <div className="sch-list" data-testid="S-60.audit">
        {entries.map((e) => (
          <div className="sch-card" key={e.id}>
            <div className="sch-card-title">{e.actionLabel}</div>
            <div className="sch-card-sub">{e.objectName ?? e.objectKind}</div>
            <div className="sch-muted">{dateTime(e.at)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="sch-tablewrap">
      <table className="sch-table" data-testid="S-60.audit">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Действие</th>
            <th>Объект</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{dateTime(e.at)}</td>
              <td title={e.action}>{e.actionLabel}</td>
              <td>{e.objectName ?? e.objectKind}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `/bind/:token` — приём ссылки из QR привязки к предмету (`S-22.qr`, В1).
 *
 * Экран тот же `S-70`: тот же результат, тот же отказ, те же слова. Разница
 * только в источнике кода — камера или ссылка, — и она не должна порождать
 * второго экрана с другим текстом.
 */
export function BindScreen({ token }: { token: string }) {
  const [state, setState] = useState<{ status: "run" } | { status: "ok"; subject: string; classLabel: string } | { status: "err"; message: string }>({ status: "run" });

  useEffect(() => {
    let alive = true;
    api
      .scan(token)
      .then((r) => alive && setState({ status: "ok", subject: r.subject, classLabel: r.classLabel }))
      .catch((e: unknown) =>
        alive && setState({ status: "err", message: e instanceof SchoolApiError ? e.message : "Код не распознан" }),
      );
    return () => {
      alive = false;
    };
  }, [token]);

  if (state.status === "run") return <Skeletons count={2} kind="row" />;
  if (state.status === "err") {
    // Причина СЛОВАМИ сервера, а не «что-то пошло не так»: истёкший код и
    // чужой код — разные ответы, и человек должен понять, какой у него.
    return (
      <div className="sch-card sch-stack" data-testid="S-70.result">
        <h2>Привязка не удалась</h2>
        <p>{state.message}</p>
        <Button kind="primary" onClick={() => navigate("/journal")}>
          К журналу
        </Button>
      </div>
    );
  }
  return (
    <div className="sch-card sch-stack" data-testid="S-70.result">
      <h2>Вы привязаны к предмету</h2>
      <p>
        {state.subject} · {state.classLabel}
      </p>
      <Button kind="primary" onClick={() => navigate("/journal")}>
        К журналу
      </Button>
    </div>
  );
}

// ─────────────────────────── S-70 · сканер QR ───────────────────────────

export function ScanScreen() {
  const mobile = useIsMobile();
  const { can } = useSession();
  const [denied, setDenied] = useState(false);
  const [result, setResult] = useState<{ subject: string; classLabel: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!mobile) {
    // Десктоп показывает не заглушку, а причину: камера ноутбука есть не у
    // всех и смотрит не туда — рабочий сценарий здесь телефонный (§7).
    return (
      <EmptyState
        testId="S-70.hint.desktop"
        title="Сканер доступен на телефоне"
        hint="Наведите камеру телефона на QR из карточки предмета — привязка произойдёт там. На компьютере сканировать нечем: камера смотрит на вас, а не на экран коллеги."
      />
    );
  }

  if (denied) return <CameraDenied testId="S-70.error.denied" />;

  if (result) {
    return (
      <div className="sch-card sch-stack" data-testid="S-70.result">
        <h2>Вы привязаны к предмету</h2>
        <p>
          {result.subject} · {result.classLabel}
        </p>
        <Button kind="primary" onClick={() => navigate("/journal")}>
          К журналу
        </Button>
      </div>
    );
  }

  return (
    <>
      <QrCamera
        testId="S-70.viewfinder"
        hint="Наведите камеру на QR из карточки предмета"
        onDenied={() => setDenied(true)}
        onCode={async (raw) => {
          // Чужой код — не «ошибка сервера», а не тот код: экран привязки к
          // предмету не должен молча пытаться скормить контракту токен входа.
          const qr = parseQr(raw);
          // Личный QR педагога (AR-179): модератора ведём в «Управление
          // компетенцией», остальным называем, чей это канал.
          if (qr?.kind === "teacher") {
            if (can("subject.write")) return navigate(`/subjects?competence=${encodeURIComponent(qr.value)}`);
            return setError("Это личный QR педагога — компетенции назначает модератор");
          }
          if (qr?.kind !== "bind") return setError("Это не код привязки к предмету");
          try {
            const r = await api.scan(qr.value);
            setResult({ subject: r.subject, classLabel: r.classLabel });
          } catch (e) {
            setError(e instanceof SchoolApiError ? e.message : "Код не распознан");
          }
        }}
      />
      {error ? <Toast text={error} /> : null}
    </>
  );
}

// ─────────────────────────── S-80 · устройства и сессии ───────────────────────────

export function DevicesScreen({ linkToken }: { linkToken?: string } = {}) {
  const [state, reload] = useAsync(() => api.sessions());
  const { toast, showToast } = useToast();
  /* Токен из ССЫЛКИ (`/link/:token`, В1) ведёт себя ровно как отсканированный:
     подтверждение обязательно, привязка не бывает молчаливой (AR-18). */
  const [pending, setPending] = useState<{ token: string; hint: string } | null>(
    linkToken ? { token: linkToken, hint: "новое устройство" } : null,
  );
  const [scanning, setScanning] = useState(false);
  const [denied, setDenied] = useState(false);
  const mobile = useIsMobile();

  if (state.status === "loading") return <Skeletons count={3} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  /* Телефон подключает ноутбук (`S-80` mobile): кнопка открывает КАМЕРУ во
     весь экран (§6), а не поле для ручного ввода кода. На десктопе кнопки нет:
     экран входа десктопа показывает только QR, кода там нет — вводить нечего,
     а камера ноутбука смотрит на человека, а не на чужой экран. */
  if (scanning) {
    if (denied) return <CameraDenied testId="S-80.error.denied" />;
    return (
      <QrCamera
        testId="S-80.viewfinder"
        hint="Наведите камеру на QR с экрана входа подключаемого устройства"
        onDenied={() => setDenied(true)}
        onCancel={() => setScanning(false)}
        onCode={(raw) => {
          const qr = parseQr(raw);
          if (qr?.kind !== "link") return showToast("Это не код подключения устройства");
          setScanning(false);
          setPending({ token: qr.value, hint: "новое устройство" });
        }}
      />
    );
  }

  const sessions = state.data;

  return (
    <>
      <div className="sch-page-head">
        <div className="sch-s80-head">
          <h1>Устройства и сессии</h1>
          {/* Одна строка о том, что такое сессия: без неё «Завершить» читается
              как «удалить устройство», а не как «выйти на нём». */}
          <p className="sch-s80-lead">
            Сессия — это вход с одного устройства. Завершение сессии выводит это устройство из кабинета.
          </p>
        </div>
        {/* Кнопка только на телефоне с камерой: без камеры подключать нечем, а
            неработающая кнопка врёт о возможности (§6); на десктопе — одна
            строка, откуда подключение делается. */}
        {mobile && hasCamera() ? (
          <Button kind="primary" testId="S-80.btn.linkDevice" onClick={() => setScanning(true)}>
            Подключить устройство
          </Button>
        ) : mobile ? null : (
          <p className="sch-muted">Подключить устройство можно с телефона: наведите его камеру на QR с экрана входа</p>
        )}
      </div>

      <div className="sch-list" data-testid="S-80.list.sessions">
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            onEnded={() => {
              showToast("Сессия завершена");
              reload();
            }}
            onError={showToast}
          />
        ))}
      </div>

      {/* Привязка не молчаливая (AR-18): подтверждение называет устройство. */}
      {pending ? (
        <Modal
          title="Подключить устройство?"
          width={420}
          testId="S-80.confirm"
        mobile="sheet"
          onClose={() => setPending(null)}
          footer={
            <div className="sch-actions">
              <Button kind="secondary" onClick={() => setPending(null)}>
                Отмена
              </Button>
              <Button
                kind="primary"
                onClick={async () => {
                  try {
                    await api.deviceLinkApprove(pending.token);
                    setPending(null);
                    showToast("Устройство подключено");
                    reload();
                  } catch (e) {
                    setPending(null);
                    showToast(e instanceof SchoolApiError ? e.message : "Не удалось подключить устройство");
                  }
                }}
              >
                Подключить
              </Button>
            </div>
          }
        >
          <p>Подключить {pending.hint}? После подключения оно получит доступ к вашей школе.</p>
        </Modal>
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

/**
 * Строка сессии (AR-187): устройство, вид клиента, канал входа, «в сети» либо
 * время последней активности. Сессия, выданная сканом с телефона, подписана
 * отдельно — человек видит, откуда у ноутбука доступ, и что закрывать, если
 * телефон потерян.
 */
function SessionRow({
  session,
  onEnded,
  onError,
}: {
  session: SessionDto;
  onEnded: () => void;
  onError: (t: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="sch-card sch-s80-session" data-parent={session.parentSessionId ?? undefined}>
      <div className="sch-s80-session-main">
        <div className="sch-s80-session-title">
          <strong>{session.deviceHint}</strong>
          <Badge tone="brand" testId="S-80.session.kind">
            {CLIENT_KIND_LABELS[session.clientKind]}
          </Badge>
          {session.parentSessionId ? <Badge muted>подключена с телефона</Badge> : null}
          {session.current ? <Badge>это устройство</Badge> : null}
        </div>
        <div className="sch-s80-session-meta">
          <span>
            {session.online ? (
              <>
                <StatusDot tone="success" />в сети
              </>
            ) : (
              <>
                <StatusDot tone="muted" />
                активность: {dateTime(session.lastSeenAt)}
              </>
            )}
          </span>
          <span>{VIA_LABELS[session.via]}</span>
        </div>
      </div>
      {/* Текущую сессию завершить нельзя: это «выйти», и кнопка для этого своя. */}
      {session.current ? null : (
        <Button
          kind="danger"
          testId="S-80.btn.endSession"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.endSession(session.id);
              onEnded();
            } catch (e) {
              onError(e instanceof SchoolApiError ? e.message : "Не удалось завершить сессию");
            } finally {
              setBusy(false);
            }
          }}
        >
          Завершить
        </Button>
      )}
    </div>
  );
}
