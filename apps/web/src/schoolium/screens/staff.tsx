/**
 * Персонал: `S-30` три секции карточек, `S-31` карточка сотрудника (`M-06`) с
 * QR-активацией и кодом входа, `M-07` добавление роли.
 *
 * Кнопки «Добавить» — по массиву `addable` секции (AR-182): учредители,
 * преподаватели и ОБА зама (bootstrap слотов замов не создаёт, а школа без
 * завуча не живёт); единственность синглтонов держит сервер. У директора
 * своей кнопки нет — роль выдаётся через `M-07`. Отдельной секции
 * «Модераторы» нет: модератор — уровень доступа, а не должность (AR-102).
 *
 * Карточка `S-30.card.person` — по эскизу владельца (2026-08-31): фото на
 * срезанной градиентной плашке слева, справа «Фамилия И.», роль строчными и —
 * у педагога с привязками — «классы:» кружками и «предмет:» именами.
 *
 * Карточка `M-06` (AR-203) — полноэкранная модалка на обеих раскладках, тело
 * до 1080px, группы в две колонки на десктопе: учётная запись (плашки ФИО,
 * логина и пароля с правкой инлайн, `M-32` «Задать пароль»), вход (именной QR,
 * код с таймером, ссылка входа с параметрами срока и числа открытий — AR-204),
 * роли, предметы педагога, активность, профиль, доступ. Читают все штатные
 * роли (`staff.read`), действуют модератор и администратор (`staff.manage`).
 */
import { useEffect, useId, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  SESSION_CLIENT_LABELS,
  SESSION_VIA_LABELS,
  ACCESS_PARAMS,
  ROLE_LABELS,
  STAFF_SECTIONS,
  usernameProblem,
  type AdminSessionDto,
  type CredentialsDto,
  type IssueLoginLinkDto,
  type LoginLinkDto,
  type SchoolRole,
  type StaffCardDto,
  type SubjectDto,
} from "@edustore/shared";
import { AccountForm, CredentialsBox } from "./account-form";
import { dateTime } from "./misc";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile, usePolling, type Async } from "../hooks";
import { Avatar, Badge, Button, CopyField, EmptyState, ErrorState, Field, Modal, PopoverOrSheet, Skeletons, StatusDot, Toast, useToast } from "../ui";
import { Icon } from "../icons";
import { useSession } from "../session";
import { navigate } from "../router";
import "./staff.css";

/** Роли, которые можно ДОБАВИТЬ карточке зарегистрированного сотрудника (AR-102). */
const ADDABLE_ROLES: SchoolRole[] = ["founder", "director", "deputy_academic", "deputy_upbringing", "teacher", "moderator", "admin"];

/** Подписи кнопок заведения карточек по ролям секций (AR-182): в секции 2 их
 *  две, поэтому «Добавить» без уточнения там не работает. */
const ADD_LABELS: Partial<Record<SchoolRole, string>> = {
  founder: "Добавить",
  teacher: "Добавить",
  deputy_academic: "Добавить завуча (УР)",
  deputy_upbringing: "Добавить зама (ВР)",
};

/** Привязки педагога для карточки: из `api.subjects()` по `binding.teacherId`. */
type TeacherMeta = { classLabels: string[]; subjects: string[] };

export function StaffScreen({ openId }: { openId?: string }) {
  const { can } = useSession();
  const [state, reload] = useAsync(() => api.staff());
  // Обогащение карточек привязками — ОТДЕЛЬНЫМ запросом: его ошибка не валит
  // экран, карточки без меты просто короче.
  const [subjState] = useAsync(() => api.subjects());
  const [expanded, setExpanded] = useState(false);
  /** M-16: форма заведения учётки (AR-154) — роль добавляемой карточки. */
  const [adding, setAdding] = useState<SchoolRole | null>(null);
  const [created, setCreated] = useState<CredentialsDto | null>(null);
  /** Свёрнутые секции мобайла (§6). По умолчанию раскрыты все три. */
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const { toast, showToast } = useToast();
  const mobile = useIsMobile();
  const mayManage = can("staff.manage");

  if (state.status === "loading") return <Skeletons count={6} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const cards = state.data;
  const open = openId ? cards.find((c) => c.id === openId) ?? null : null;
  const shown = expanded || cards.length > 0;

  // userId педагога → его классы и дисциплины (джойн binding.teacherId ↔ card.userId).
  const teacherMeta = new Map<string, TeacherMeta>();
  if (subjState.status === "ready") {
    const acc = new Map<string, { classes: Set<string>; names: Set<string> }>();
    for (const s of subjState.data)
      for (const b of s.bindings) {
        const cur = acc.get(b.teacherId) ?? { classes: new Set<string>(), names: new Set<string>() };
        cur.classes.add(s.classLabel);
        cur.names.add(s.name);
        acc.set(b.teacherId, cur);
      }
    for (const [id, v] of acc)
      teacherMeta.set(id, {
        classLabels: [...v.classes].sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b, "ru")),
        subjects: [...v.names].sort((a, b) => a.localeCompare(b, "ru")),
      });
  }

  return (
    <>
      <div className="sch-page-head">
        <h1>Персонал</h1>
        {mayManage ? (
          <Button kind="primary" testId="S-30.btn.activate" onClick={() => setExpanded(true)}>
            Активация персонала
          </Button>
        ) : null}
      </div>

      {!shown ? (
        <EmptyState
          testId="S-30.empty"
          title="Персонал не активирован"
          hint={mayManage ? "Активируйте сотрудников — они получат доступ" : "Сотрудники появятся, когда модератор их активирует"}
          action={
            mayManage ? (
              <Button kind="primary" testId="S-30.btn.activate" onClick={() => setExpanded(true)}>
                Активация персонала
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="sch-sections">
          {STAFF_SECTIONS.map((sec) => (
            /* На мобайле секции сворачиваемые (§6): три раскрытых списка на
               390px превращают экран в бесконечную ленту, в которой третья
               секция — «Преподаватели», самая нужная, — всегда внизу.
               На десктопе три колонки видны разом, и сворачивать нечего. */
            <section
              key={sec.level}
              data-testid={`S-30.section.level${sec.level}`}
              className={mobile ? "sch-section--collapsible" : undefined}
            >
              <div className="sch-row sch-row--between">
                {mobile ? (
                  <button
                    className="sch-section-toggle"
                    aria-expanded={!collapsed.has(sec.level)}
                    onClick={() =>
                      setCollapsed((cur) => {
                        const next = new Set(cur);
                        if (next.has(sec.level)) next.delete(sec.level);
                        else next.add(sec.level);
                        return next;
                      })
                    }
                  >
                    <span aria-hidden="true">
                      <Icon name={collapsed.has(sec.level) ? "chevronRight" : "chevronDown"} size={18} />
                    </span>{" "}
                    {sec.title}
                  </button>
                ) : (
                  <h2 className="sch-section-title">{sec.title}</h2>
                )}
                {/* Кнопка на каждую заводимую роль секции (AR-182). Смок стоит
                    на addFounder/addTeacher — их не переименовывать. */}
                {mayManage
                  ? sec.addable.map((role) => (
                      <Button
                        key={role}
                        kind="secondary"
                        testId={
                          role === "founder"
                            ? "S-30.btn.addFounder"
                            : role === "teacher"
                              ? "S-30.btn.addTeacher"
                              : role === "deputy_academic"
                                ? "S-30.btn.addDeputyAcademic"
                                : "S-30.btn.addDeputyUpbringing"
                        }
                        onClick={() => setAdding(role)}
                      >
                        {ADD_LABELS[role] ?? "Добавить"}
                      </Button>
                    ))
                  : null}
              </div>
              {mobile && collapsed.has(sec.level) ? null : (
                <div className="sch-cards--3">
                  {cards
                    .filter((c) => c.section === sec.level)
                    .map((c) => (
                      <PersonCard key={c.id} card={c} meta={c.userId ? teacherMeta.get(c.userId) : undefined} />
                    ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {open ? <StaffCardModal card={open} subjects={subjState} onClose={() => navigate("/staff")} onChanged={reload} /> : null}

      {/* M-16 — заведение учётки: ФИО + юзернейм + пароль (AR-154). */}
      {adding ? (
        <Modal title={`Новая учётка: ${ROLE_LABELS[adding]}`} width={440} onClose={() => setAdding(null)} testId="M-16" mobile="fullscreen">
          <AccountForm
            submitLabel="Завести учётку"
            testPrefix="M-16"
            onSubmit={async (dto) => {
              const r = await api.addStaffCard({ role: adding, ...dto });
              setAdding(null);
              setCreated(r.credentials);
              reload();
            }}
          />
        </Modal>
      ) : null}
      {created ? (
        <Modal title="Учётка заведена" width={440} onClose={() => setCreated(null)} testId="M-17" mobile="sheet">
          <CredentialsBox credentials={created} />
        </Modal>
      ) : null}
      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

function PersonCard({ card, meta }: { card: StaffCardDto; meta?: TeacherMeta }) {
  // «Фамилия И.» — как на эскизе; полное имя живёт в карточке M-06.
  const title =
    card.filled && card.lastName && card.firstName
      ? `${card.lastName} ${card.firstName[0]}.`
      : card.name ?? "Учётка не заведена";
  return (
    <button
      className={
        card.registered
          ? "sch-card sch-card--staff sch-card--clickable"
          : "sch-card sch-card--staff sch-card--clickable sch-card--locked"
      }
      data-testid="S-30.card.person"
      data-card-id={card.id}
      onClick={() => navigate(`/staff/${card.id}`)}
    >
      <span className={card.filled ? "sch-staff-plaque" : "sch-staff-plaque sch-staff-plaque--locked"} aria-hidden="true">
        {card.filled ? <Avatar large name={card.name} url={card.avatarUrl} /> : <Icon name="lock" size={20} />}
      </span>
      <span className="sch-staff-body">
        <span className="sch-card-title">{title}</span>
        <span className="sch-card-sub sch-staff-role">{card.roles.map((r) => ROLE_LABELS[r]).join(", ")}</span>
        {/* Строки привязок — ТОЛЬКО у педагога с позициями: «классы: —» не рендерим. */}
        {meta && meta.classLabels.length > 0 ? (
          <span className="sch-staff-line">
            классы:
            {meta.classLabels.map((l) => (
              <span key={l} className="sch-class-dot">
                {l}
              </span>
            ))}
          </span>
        ) : null}
        {meta && meta.subjects.length > 0 ? (
          <span className="sch-staff-line">предмет: {meta.subjects.join(", ")}</span>
        ) : null}
        {card.deactivated ? (
          <span className="sch-staff-line">
            <Badge muted>доступ закрыт</Badge>
          </span>
        ) : card.filled && !card.registered ? (
          <span className="sch-staff-line">
            <Badge muted>не авторизован</Badge>
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ─────────────────────────── S-31 · карточка сотрудника (M-06) ───────────────────────────

/** Подписи срока ссылки входа (AR-204): значения — из `ACCESS_PARAMS.loginLinkTtlOptions`. */
const LINK_TTL_LABELS: Record<number, string> = { 24: "24 ч", 48: "48 ч", 168: "7 дней" };

/**
 * Ссылка входа с параметрами (AR-204): срок и число открытий выбирает
 * выпускающий — модератор или администратор (`staff.manage`). Состояние живёт
 * в хуке, селекты с кнопкой и панель — отдельными элементами, чтобы ряд стоял
 * среди действий своей группы, а панель — под ним.
 */
function useLoginLink(cardId: string, onError: (t: string) => void) {
  const [link, setLink] = useState<LoginLinkDto | null>(null);
  const [busy, setBusy] = useState(false);
  const issue = async (dto: IssueLoginLinkDto) => {
    setBusy(true);
    try {
      setLink(await api.staffLoginLink(cardId, dto));
    } catch (e) {
      onError(e instanceof SchoolApiError ? e.message : "Не удалось выдать ссылку для входа");
    } finally {
      setBusy(false);
    }
  };
  return { link, busy, issue };
}

/** Ряд «срок · открытий · Ссылка для входа» (AR-204): дефолты 48 ч и без лимита. */
function LoginLinkControls({ busy, onIssue }: { busy: boolean; onIssue: (dto: IssueLoginLinkDto) => void }) {
  const [ttl, setTtl] = useState(String(ACCESS_PARAMS.loginLinkTtlHours));
  const [uses, setUses] = useState("");
  const ttlId = useId();
  const usesId = useId();
  return (
    <div className="sch-m06-linkrow">
      <div className="sch-field sch-m06-linkfield">
        <label className="sch-field-label" htmlFor={ttlId}>
          Срок
        </label>
        <select id={ttlId} className="sch-input" data-testid="S-31.select.linkTtl" value={ttl} onChange={(e) => setTtl(e.target.value)}>
          {ACCESS_PARAMS.loginLinkTtlOptions.map((h) => (
            <option key={h} value={String(h)}>
              {LINK_TTL_LABELS[h] ?? hoursWord(h)}
            </option>
          ))}
        </select>
      </div>
      <div className="sch-field sch-m06-linkfield">
        <label className="sch-field-label" htmlFor={usesId}>
          Открытий
        </label>
        <select id={usesId} className="sch-input" data-testid="S-31.select.linkUses" value={uses} onChange={(e) => setUses(e.target.value)}>
          {ACCESS_PARAMS.loginLinkUsesOptions.map((u) => (
            <option key={String(u)} value={u === null ? "" : String(u)}>
              {u === null ? "без лимита" : String(u)}
            </option>
          ))}
        </select>
      </div>
      <Button
        kind="secondary"
        testId="S-31.btn.loginLink"
        loading={busy}
        onClick={() =>
          onIssue({
            ttlHours: Number(ttl) as IssueLoginLinkDto["ttlHours"],
            maxUses: uses === "" ? null : Number(uses),
          })
        }
      >
        Ссылка для входа
      </Button>
    </div>
  );
}

/** «48 часов», «24 часа»: склоняется только слово. */
const hoursWord = (n: number): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m100 >= 11 && m100 <= 14 ? "часов" : m10 === 1 ? "час" : m10 >= 2 && m10 <= 4 ? "часа" : "часов";
  return `${n} ${word}`;
};

function LoginLinkBox({ link }: { link: LoginLinkDto }) {
  // Тот же маршрут, что у ссылки первого модератора (AR-93): `/bootstrap/:token`
  // уже умеет обменять токен на сессию, второго экрана не нужно.
  const url = `${window.location.origin}/bootstrap/${link.token}`;
  return (
    <div className="sch-canvas sch-qr sch-m06-link" data-testid="S-31.loginLink">
      <QRCodeSVG value={url} size={160} />
      <CopyField value={url} label="Ссылка для входа" />
      <p className="sch-muted">
        действует до {dateTime(link.expiresAt)},{" "}
        {link.maxUses === null ? "без лимита открытий" : `использований ${link.useCount} из ${link.maxUses}`}
      </p>
    </div>
  );
}

/**
 * Таймер «мм:сс» до `until` (`S-31.timer.loginCode`, AR-203): по нулю зовёт
 * `onZero` — панель кода гаснет, а не показывает мёртвый код.
 */
function Countdown({ until, testId, onZero }: { until: string; testId: string; onZero: () => void }) {
  const secondsLeft = () => Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
  const [left, setLeft] = useState(secondsLeft);
  // Зависимость — только `until`: новый код — новый отсчёт; тик раз в секунду.
  useEffect(() => {
    setLeft(secondsLeft());
    const t = window.setInterval(() => setLeft(secondsLeft()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  useEffect(() => {
    if (left === 0) onZero();
  }, [left]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <span className="sch-m06-timer" data-testid={testId} aria-live="off">
      {mm}:{ss}
    </span>
  );
}

/**
 * Активность учётки (AR-187): когда активирована, когда была в сети, сколько
 * сессий живо — и пять последних сессий строками. Грузится своим запросом при
 * открытии карточки: его отказ не валит карточку, у блока свой «Повторить».
 */
function ActivityBlock({ cardId }: { cardId: string }) {
  const [state, reload] = useAsync(() => api.staffActivity(cardId), [cardId]);
  let body: React.ReactNode;
  if (state.status === "loading") body = <Skeletons count={3} kind="row" />;
  else if (state.status === "error") body = <ErrorState message={state.message} onRetry={reload} />;
  else {
    const a = state.data;
    const latest = [...a.sessions].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 5);
    body = (
      <>
        <dl className="sch-m06-kv">
          <dt>Активирован</dt>
          <dd>{a.activatedAt ? dateTime(a.activatedAt) : "ещё нет"}</dd>
          <dt>Последняя активность</dt>
          <dd>{a.lastSeenAt ? dateTime(a.lastSeenAt) : "входов не было"}</dd>
          <dt>Сессии</dt>
          <dd>
            живых {a.activeSessions} из {a.totalSessions} всего
          </dd>
        </dl>
        {latest.length > 0 ? (
          <div className="sch-m06-sessions">
            {latest.map((s) => (
              <ActivitySession key={s.id} session={s} />
            ))}
          </div>
        ) : null}
      </>
    );
  }
  return <div data-testid="S-31.activity">{body}</div>;
}

function ActivitySession({ session }: { session: AdminSessionDto }) {
  const live = session.status === "active";
  return (
    <div className="sch-m06-session" data-testid="S-31.activity.session" data-status={session.status}>
      <div className="sch-m06-session-title">
        <strong>{session.deviceHint}</strong>
        <Badge muted>{SESSION_CLIENT_LABELS[session.clientKind]}</Badge>
      </div>
      <div className="sch-m06-session-meta">
        <span>{SESSION_VIA_LABELS[session.via]}</span>
        <span>
          {!live ? (
            <>
              <StatusDot tone="muted" />
              завершена
            </>
          ) : session.online ? (
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
      </div>
    </div>
  );
}

/**
 * Плашки учётки (AR-203): ФИО, логин, пароль. Пароль не хранится и не
 * показывается (AR-156) — плашка несёт маску, рядом «Перевыпустить» и «Задать
 * пароль». Правка ФИО и логина — инлайн полями на месте плашек.
 */
function AccountPlaques({
  card,
  mayManage,
  onEdit,
  onReissue,
  onSetPassword,
}: {
  card: StaffCardDto;
  mayManage: boolean;
  onEdit: () => void;
  onReissue: () => void;
  onSetPassword: (anchor: DOMRect) => void;
}) {
  return (
    <div className="sch-m06-plaques">
      <div className="sch-m06-plaque" data-testid="S-31.plaque.name">
        <span className="sch-m06-plaque-text">
          <span className="sch-m06-plaque-label">ФИО</span>
          {/* ФИО целиком: displayName сервера — «Фамилия Имя», отчество берётся из частей (AR-203) */}
          <span className="sch-m06-plaque-value">{[card.lastName, card.firstName, card.middleName].filter(Boolean).join(" ") || card.name || "—"}</span>
        </span>
        {mayManage ? (
          <span className="sch-m06-plaque-actions">
            <Button kind="secondary" testId="S-31.btn.editAccount" onClick={onEdit}>
              Изменить
            </Button>
          </span>
        ) : null}
      </div>
      <div className="sch-m06-plaque" data-testid="S-31.plaque.username">
        <span className="sch-m06-plaque-text">
          <span className="sch-m06-plaque-label">Логин</span>
          <span className="sch-m06-plaque-value">{card.username ?? "учётка не заведена"}</span>
        </span>
      </div>
      <div className="sch-m06-plaque" data-testid="S-31.plaque.password">
        <span className="sch-m06-plaque-text">
          <span className="sch-m06-plaque-label">Пароль</span>
          {/* Маска, а не значение: текущий пароль системе неизвестен (AR-156). */}
          <span className="sch-m06-plaque-value" aria-label="пароль скрыт">
            ••••••••
          </span>
        </span>
        {mayManage ? (
          <span className="sch-m06-plaque-actions">
            <Button kind="ghost" testId="S-31.btn.reissuePassword" onClick={onReissue}>
              Перевыпустить пароль
            </Button>
            <Button kind="secondary" testId="S-31.btn.setPassword" onClick={(e) => onSetPassword(e.currentTarget.getBoundingClientRect())}>
              Задать пароль
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Инлайн-правка ФИО и логина (AR-203, §11 строка 51): та же живая проверка
 * юзернейма, что в `AccountForm`; неизменённый логин не проверяется — он занят
 * этой же учёткой. Отказы `USERNAME_TAKEN`/`USERNAME_INVALID` — под полем.
 */
function AccountEditor({ card, onSaved, onCancel }: { card: StaffCardDto; onSaved: (c: StaffCardDto) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    lastName: card.lastName ?? "",
    firstName: card.firstName ?? "",
    middleName: card.middleName ?? "",
    username: card.username ?? "",
  });
  const [free, setFree] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checkTimer = useRef<number | undefined>(undefined);
  const username = form.username;
  const unchanged = username === (card.username ?? "");

  useEffect(() => {
    setFree(null);
    if (!username || unchanged || usernameProblem(username)) return;
    window.clearTimeout(checkTimer.current);
    checkTimer.current = window.setTimeout(() => {
      api
        .usernameFree(username)
        .then((r) => setFree(r.free))
        .catch(() => setFree(null));
    }, 300);
    return () => window.clearTimeout(checkTimer.current);
  }, [username, unchanged]);

  const problem = username ? usernameProblem(username) : null;
  const usernameHint =
    problem === "invalid"
      ? "строчные латинские буквы, цифры и подчёркивание, 3–30 знаков"
      : problem === "reserved"
        ? "это имя зарезервировано"
        : unchanged
          ? "текущий логин"
          : free === false
            ? "занят — выберите другой"
            : free === true
              ? "свободен"
              : "проверяется";
  const ready = form.lastName.trim() && form.firstName.trim() && username && !problem && free !== false;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateStaffAccount(card.id, {
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        username,
      });
      // Контракт §11 строки 51 тело ответа не называет — ждём карточку; иначе перечитываем её.
      onSaved(r && typeof r === "object" && "id" in r ? r : await api.staffCard(card.id));
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
      setBusy(false);
    }
  };

  return (
    <div className="sch-stack">
      <Field label="Фамилия" testId="S-31.input.lastName" value={form.lastName} autoCapitalize="words" autoFocus onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
      <Field label="Имя" testId="S-31.input.firstName" value={form.firstName} autoCapitalize="words" onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
      <Field label="Отчество" hint="при наличии" testId="S-31.input.middleName" value={form.middleName} autoCapitalize="words" onChange={(e) => setForm({ ...form, middleName: e.target.value })} />
      <Field
        label="Логин"
        hint={usernameHint}
        testId="S-31.input.username"
        value={username}
        autoCapitalize="none"
        autoComplete="off"
        onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
        error={error}
      />
      <div className="sch-actions sch-actions--start">
        <Button kind="primary" testId="S-31.btn.saveAccount" disabled={!ready} loading={busy} onClick={save}>
          Сохранить
        </Button>
        <Button kind="ghost" testId="S-31.btn.cancelAccount" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/**
 * `M-32` «Задать пароль» (AR-203): поповер 320px у кнопки / нижний лист.
 * Пустое поле — сервер генерирует пароль сам; ответ показывается один раз в
 * `CredentialsBox` на карточке. `PASSWORD_TOO_SHORT` — под полем.
 */
function SetPasswordLayer({ anchor, cardId, onClose, onDone }: { anchor: DOMRect; cardId: string; onClose: () => void; onDone: (c: CredentialsDto) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = password.trim();
      onDone(await api.setStaffPassword(cardId, trimmed ? { password: trimmed } : {}));
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
      setBusy(false);
    }
  };
  return (
    <PopoverOrSheet label="Задать пароль" width={320} anchor={anchor} onClose={onClose} testId="M-32" level={2}>
      <div className="sch-stack sch-pop-form">
        <Field
          label="Новый пароль"
          hint={`пусто — сгенерировать; не короче ${ACCESS_PARAMS.passwordMinLength} знаков`}
          testId="M-32.input.password"
          value={password}
          autoComplete="new-password"
          autoCapitalize="none"
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
        <div className="sch-actions">
          <Button kind="primary" testId="M-32.btn.save" loading={busy} onClick={save}>
            Задать
          </Button>
        </div>
      </div>
    </PopoverOrSheet>
  );
}

/** «группа 1», «группы 1, 2» — подпись групповой позиции. */
const groupsWord = (nos: number[]): string => (nos.length === 1 ? `группа ${nos[0]}` : `группы ${nos.join(", ")}`);

/**
 * Группа «Предметы» (AR-203): привязки педагога из `GET /v1/subjects` строками
 * «Предмет · класс (группа N) · N ч/год». Данные — те же, что у плиток `S-30`:
 * второй запрос карточке не нужен. Управление привязками живёт в `M-25` —
 * отсюда только переход `S-31.btn.competence`.
 */
function SubjectsGroup({ userId, subjects, mayManage }: { userId: string; subjects: Async<SubjectDto[]>; mayManage: boolean }) {
  let body: React.ReactNode;
  if (subjects.status === "loading") body = <Skeletons count={2} kind="row" />;
  else if (subjects.status === "error") body = <p className="sch-muted">привязки не загрузились: {subjects.message}</p>;
  else {
    const rows: { key: string; classLabel: string; text: string }[] = [];
    for (const s of subjects.data)
      for (const b of s.bindings) {
        if (b.teacherId !== userId) continue;
        const group = b.scope === "group" && b.groupNos.length > 0 ? ` (${groupsWord(b.groupNos)})` : "";
        rows.push({ key: b.id, classLabel: s.classLabel, text: `${s.name} · ${s.classLabel}${group} · ${b.hoursPerYear} ч/год` });
      }
    rows.sort((a, b) => parseInt(a.classLabel, 10) - parseInt(b.classLabel, 10) || a.text.localeCompare(b.text, "ru"));
    body =
      rows.length === 0 ? (
        <p className="sch-muted">привязок нет</p>
      ) : (
        <ul className="sch-m06-subjects">
          {rows.map((r) => (
            <li key={r.key}>{r.text}</li>
          ))}
        </ul>
      );
  }
  return (
    <section className="sch-m06-group" data-testid="S-31.subjects">
      <h3 className="sch-section-title">Предметы</h3>
      {body}
      {mayManage ? (
        <div className="sch-actions sch-actions--start">
          <Button kind="ghost" testId="S-31.btn.competence" onClick={() => navigate(`/subjects?competence=${encodeURIComponent(userId)}`)}>
            Компетенции
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function StaffCardModal({
  card,
  subjects,
  onClose,
  onChanged,
}: {
  card: StaffCardDto;
  subjects: Async<SubjectDto[]>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const [cur, setCur] = useState(card);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"waiting" | "scanned" | "used" | "expired">("waiting");
  // Имя регистрации приходит ТОЛЬКО из поллинга: у заполненной, но не
  // активированной карточки `card.name` уже есть, а «Зарегистрирован» — ещё нет.
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const [loginCode, setLoginCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [addRole, setAddRole] = useState<DOMRect | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "deactivate">(null);
  const [editing, setEditing] = useState(false);
  const [pwdAnchor, setPwdAnchor] = useState<DOMRect | null>(null);
  const { toast, showToast } = useToast();
  // Карточку читают все штатные роли (`staff.read`); действия — `staff.manage`
  // (модератор и администратор), включая ссылку входа (AR-203, AR-204).
  const mayManage = can("staff.manage");
  const loginLink = useLoginLink(card.id, showToast);
  const qrSize = useIsMobile() ? 200 : 240;

  const [fullName, setFullName] = useState<string | null>(null);
  const [creds, setCreds] = useState<CredentialsDto | null>(null);

  // QR активации выпускается при открытии ЗАПОЛНЕННОЙ карточки (AR-161);
  // закрытие карточки его гасит. У карточки без учётки QR не существует.
  useEffect(() => {
    if (cur.registered || !cur.filled || !mayManage) return;
    api
      .activationToken(cur.id)
      .then((t) => {
        setToken(t.token);
        setFullName(t.fullName ?? null);
      })
      .catch(() => undefined);
  }, [cur.id, cur.registered, cur.filled, mayManage]);

  usePolling(
    async () => {
      const r = await api.activationStatus(cur.id).catch(() => null);
      if (!r) return;
      setStatus(r.status as typeof status);
      setRegisteredName(r.registeredName ?? null);
      if (r.registeredName) {
        const fresh = await api.staffCard(cur.id).catch(() => null);
        if (fresh) setCur(fresh);
        onChanged();
      }
    },
    ACCESS_PARAMS.pollIntervalMs,
    cur.filled && !cur.registered && mayManage && status === "waiting",
  );

  const close = () => {
    // `S-31.btn.close` гасит QR: код не переживает встречу (AR-76).
    if (cur.filled && !cur.registered && mayManage) void api.closeCard(cur.id).catch(() => undefined);
    onClose();
  };

  const reissuePassword = async () => {
    try {
      setCreds(await api.staffCredentials(cur.id));
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    }
  };

  const act = async (fn: () => Promise<StaffCardDto | { ok: boolean }>) => {
    try {
      const r = await fn();
      if (r && typeof r === "object" && "id" in r) setCur(r as StaffCardDto);
      onChanged();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    }
  };

  const isTeacher = cur.roles.includes("teacher");

  return (
    <>
      {/* Полноэкранная на обеих раскладках (AR-203): ширина реестра здесь —
          ширина колонки тела (`.sch-m06-body`), инлайном она не ставится. */}
      <Modal
        title={cur.name ?? "Карточка сотрудника"}
        width={1080}
        desktop="fullscreen"
        mobile="fullscreen"
        onClose={close}
        testId="M-06"
        footer={
          <div className="sch-actions">
            <Button kind="ghost" testId="S-31.btn.close" onClick={close}>
              Закрыть
            </Button>
          </div>
        }
      >
        {!cur.filled ? (
          /* Карточка-слот без учётки (слоты из bootstrap): сначала ФИО и креды. */
          <div className="sch-m06-body sch-m06-body--narrow sch-stack">
            <AccountForm
              submitLabel="Завести учётку"
              testPrefix="S-31.fill"
              onSubmit={async (dto) => {
                const r = await api.fillStaffCard(cur.id, dto);
                setCur(r.card);
                setCreds(r.credentials);
                onChanged();
              }}
            />
            {creds ? <CredentialsBox credentials={creds} /> : null}
          </div>
        ) : (
          /* Панель управления карточкой — ОДНА раскладка группами для любой
             учётки, активированной и нет (AR-203): учётная запись, вход, роли,
             предметы, активность, профиль и в самом низу — доступ. Группы без
             действий видят все штатные роли, группы действий — `staff.manage`.
             Разрушающие действия последними. */
          <div className="sch-m06-body sch-m06-groups">
            <section className="sch-m06-group">
              <h3 className="sch-section-title">Учётная запись</h3>
              <div className="sch-row">
                <Avatar name={cur.name} url={cur.avatarUrl} />
                <div className="sch-m06-who">
                  {cur.registered ? (
                    <span className="sch-muted" data-testid="S-31.status">
                      Зарегистрирован: {cur.name}
                    </span>
                  ) : (
                    <span className="sch-muted">Ещё не входил: QR активации, ссылка и код — в группе «Вход»</span>
                  )}
                </div>
                {cur.deactivated ? (
                  <span data-testid="S-31.badge.inactive">
                    <Badge muted>доступ закрыт</Badge>
                  </span>
                ) : null}
              </div>
              {editing ? (
                <AccountEditor
                  card={cur}
                  onSaved={(c) => {
                    setCur(c);
                    setEditing(false);
                    onChanged();
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <AccountPlaques card={cur} mayManage={mayManage} onEdit={() => setEditing(true)} onReissue={reissuePassword} onSetPassword={setPwdAnchor} />
              )}
              {creds ? <CredentialsBox credentials={creds} /> : null}
            </section>

            {mayManage ? (
              <section className="sch-m06-group">
                <h3 className="sch-section-title">Вход</h3>
                {!cur.registered ? (
                  <div className="sch-qr">
                    {/* Именной QR (AR-161): над кодом — ФИО, сканирует названный человек. */}
                    <h3 data-testid="S-31.qr.fullName" style={{ margin: 0 }}>
                      {fullName ?? cur.name}
                    </h3>
                    <div className="sch-qr-frame" data-testid="S-31.qr">
                      {token ? (
                        <QRCodeSVG value={`${window.location.origin}/join/${token}`} size={qrSize} />
                      ) : (
                        <div className="sch-skeleton sch-skeleton--qr" />
                      )}
                    </div>
                    <p data-testid="S-31.status">
                      {registeredName ? `Зарегистрирован: ${registeredName}` : "Ожидание сканирования"}
                    </p>
                    <p className="sch-muted">
                      @{cur.username} · код живёт {ACCESS_PARAMS.activationTtlMinutes} минут либо до закрытия карточки
                    </p>
                  </div>
                ) : null}
                {cur.registered ? (
                  <div className="sch-actions sch-actions--start">
                    <Button
                      kind="primary"
                      testId="S-31.btn.loginCode"
                      onClick={async () => {
                        try {
                          setLoginCode(await api.loginCode(cur.id));
                        } catch (e) {
                          showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
                        }
                      }}
                    >
                      QR и код для входа
                    </Button>
                  </div>
                ) : null}
                {loginCode ? (
                  <div className="sch-canvas sch-qr" data-testid="S-31.loginCode">
                    <QRCodeSVG value={`${window.location.origin}/login/code/${loginCode.code}`} size={160} />
                    <strong className="sch-m06-code">{loginCode.code}</strong>
                    <p className="sch-muted">
                      Код живёт {ACCESS_PARAMS.loginCodeTtlMinutes} минут, одноразовый ·{" "}
                      <Countdown until={loginCode.expiresAt} testId="S-31.timer.loginCode" onZero={() => setLoginCode(null)} />
                    </p>
                  </div>
                ) : null}
                {/* Ссылка входа с параметрами (AR-204): у заполненной и у
                    активированной карточки; выдают модератор и администратор. */}
                <LoginLinkControls busy={loginLink.busy} onIssue={loginLink.issue} />
                {loginLink.link ? <LoginLinkBox link={loginLink.link} /> : null}
              </section>
            ) : null}

            <section className="sch-m06-group">
              <h3 className="sch-section-title">Роли</h3>
              <div className="sch-chips">
                {cur.roles.map((r) => (
                  <span key={r} className="sch-row" style={{ gap: "var(--sp-4)" }}>
                    <Badge>{ROLE_LABELS[r]}</Badge>
                    {mayManage ? (
                      <Button kind="ghost" testId="S-31.btn.removeRole" onClick={() => act(() => api.removeRole(cur.id, r))}>
                        Снять
                      </Button>
                    ) : null}
                  </span>
                ))}
              </div>
              {mayManage ? (
                <div className="sch-actions sch-actions--start">
                  <Button kind="secondary" testId="S-31.btn.addRole" onClick={(e) => setAddRole(e.currentTarget.getBoundingClientRect())}>
                    Добавить роль
                  </Button>
                </div>
              ) : null}
            </section>

            {/* Предметы — только у педагога: у остальных группы нет вовсе (AR-203). */}
            {isTeacher && cur.userId ? <SubjectsGroup userId={cur.userId} subjects={subjects} mayManage={mayManage} /> : null}

            {mayManage ? (
              <section className="sch-m06-group">
                <h3 className="sch-section-title">Активность</h3>
                <ActivityBlock cardId={cur.id} />
              </section>
            ) : null}

            <section className="sch-m06-group">
              <h3 className="sch-section-title">Профиль</h3>
              {/* Ссылка на КАРТОЧКУ, не на вход (AR-187, AR-203): открывает этот же
                  экран тому, у кого доступ уже есть; никакого токена не несёт. */}
              <CopyField testId="S-31.btn.copyProfile" label="Ссылка на профиль" value={`${window.location.origin}/staff/${cur.id}`} />
              <p className="sch-muted">Открывает карточку сотрудника; входа не даёт</p>
            </section>

            {mayManage ? (
              <section className="sch-m06-group">
                <h3 className="sch-section-title">Доступ</h3>
                <div className="sch-actions sch-actions--start">
                  {cur.deactivated ? (
                    <Button kind="secondary" testId="S-31.btn.reactivateStaff" onClick={() => act(() => api.reactivateStaff(cur.id))}>
                      Вернуть доступ
                    </Button>
                  ) : null}
                  {cur.registered ? (
                    <>
                      <Button
                        kind="danger"
                        testId="S-31.btn.revokeSessions"
                        onClick={() => act(() => api.revokeSessions(cur.id))}
                      >
                        Закрыть активные сессии
                      </Button>
                      {/* «Просканировал не тот» (AR-153): сессии чужого устройства
                          закрываются, карточка возвращается в «Не авторизованные». */}
                      <Button
                        kind="danger"
                        testId="S-31.btn.revokeActivation"
                        onClick={() => act(() => api.revokeStaffActivation(cur.id))}
                      >
                        Отозвать активацию
                      </Button>
                    </>
                  ) : null}
                  {/* Подмену решает СЕРВЕР: ровно одна кнопка из двух (AR-89);
                      у деактивированной карточки вместо них «Вернуть доступ». */}
                  {cur.deactivated ? null : cur.hasHistory ? (
                    <Button kind="danger" testId="S-31.btn.deactivateStaff" onClick={() => setConfirm("deactivate")}>
                      Деактивировать
                    </Button>
                  ) : (
                    <Button kind="danger" testId="S-31.btn.deleteStaff" onClick={() => setConfirm("delete")}>
                      Удалить сотрудника
                    </Button>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </Modal>

      {/*
        M-07 — добавление роли: поповер 320px У КНОПКИ на десктопе, нижний лист
        на мобайле (§3). До этапа 3 здесь стояла центрированная модалка, хотя
        комментарий рядом называл поповер: реестр говорил одно, экран делал
        другое, и заметить это было нечем — идентификаторы модалок ворота не
        проверяют, а смок до `M-07` не доходит.
      */}
      {addRole ? (
        <PopoverOrSheet
          label="Добавить роль"
          width={320}
          anchor={addRole}
          onClose={() => setAddRole(null)}
          testId="M-07"
          level={2}
        >
          <div className="sch-stack">
            {ADDABLE_ROLES.filter((r) => !cur.roles.includes(r)).map((r) => (
              <Button
                key={r}
                kind="secondary"
                onClick={async () => {
                  await act(() => api.addRole(cur.id, r));
                  setAddRole(null);
                }}
              >
                {ROLE_LABELS[r]}
              </Button>
            ))}
          </div>
        </PopoverOrSheet>
      ) : null}

      {/* M-32 — задать пароль: поповер у кнопки / нижний лист, второй уровень (AR-82). */}
      {pwdAnchor ? (
        <SetPasswordLayer
          anchor={pwdAnchor}
          cardId={cur.id}
          onClose={() => setPwdAnchor(null)}
          onDone={(c) => {
            setCreds(c);
            setPwdAnchor(null);
          }}
        />
      ) : null}

      {/* M-13 — подтверждение разрушающего действия над сотрудником. */}
      {confirm ? (
        <Modal
          title="Подтверждение"
          width={400}
          onClose={() => setConfirm(null)}
          testId="M-13"
          mobile="sheet"
          level={2}
          footer={
            <div className="sch-actions">
              <Button kind="ghost" onClick={() => setConfirm(null)}>
                Отмена
              </Button>
              <Button
                kind={confirm === "delete" ? "danger" : "primary"}
                onClick={async () => {
                  if (confirm === "delete") {
                    try {
                      await api.deleteStaff(cur.id);
                      onChanged();
                      onClose();
                    } catch (e) {
                      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
                      setConfirm(null);
                    }
                  } else {
                    await act(() => api.deactivateStaff(cur.id));
                    setConfirm(null);
                  }
                }}
              >
                {confirm === "delete" ? "Удалить" : "Деактивировать"}
              </Button>
            </div>
          }
        >
          <p>
            {confirm === "delete"
              ? `Удалить ${cur.name}? Обратной операции нет.`
              : `Деактивировать ${cur.name}? Привязки к предметам снимутся, отметки останутся.`}
          </p>
        </Modal>
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}
