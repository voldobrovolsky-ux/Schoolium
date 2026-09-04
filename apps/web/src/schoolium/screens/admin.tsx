/**
 * `S-62` · кабинет администратора (AR-186…AR-189): шесть разделов на одном
 * маршруте, раздел отражён в URL (AR-41).
 *
 * Кабинет держит то, чего нет ни у модератора, ни у завуча: карту подключений
 * всех людей школы (AR-187), реестры сети и устройств, матрицу прав, полный
 * аудит и политики доступа (AR-188). Учётки и активации остаются на `S-30`/
 * `S-31` — отсюда на них только переходы.
 *
 * Три состояния у каждого раздела свои (§0): скелетоны той же геометрии,
 * пустое состояние с одним действием, ошибка словами и «Повторить». Экран
 * целиком пустым не бывает — навигация разделов стоит всегда.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  SCHOOL_STATE_LABELS,
  SESSION_CLIENT_LABELS,
  SESSION_REVOKE_REASON_LABELS,
  SESSION_VIA_LABELS,
  ASSET_KINDS,
  ASSET_KIND_LABELS,
  DEFAULT_ROLE_LIMITS,
  MUTATION_PERMISSIONS,
  NETWORK_AUDIENCES,
  NETWORK_AUDIENCE_LABELS,
  OVERSIGHT_PERMISSIONS,
  PROJECTION_PERMISSIONS,
  READ_PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  SCHOOL_ROLES,
  STAFF_ROLES,
  type AccessPolicyDto,
  type AdminDeviceUserDto,
  type AdminOverviewDto,
  type AdminSessionDto,
  type AssetKind,
  type IncidentResultDto,
  type LoginLinkDto,
  type NetworkAudience,
  type RoleLimits,
  type SchoolAssetDto,
  type SchoolNetworkDto,
  type SchoolPermission,
  type SchoolRole,
  type SessionLimits,
  type SessionRevokeReason,
  type SessionVia,
} from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile } from "../hooks";
import { Icon, type IconName } from "../icons";
import { ADMIN_SECTIONS, navigate, type AdminSection } from "../router";
import { useMe, useSession } from "../session";
import {
  Avatar,
  Badge,
  Button,
  CopyField,
  EmptyState,
  ErrorState,
  Field,
  LinkRow,
  Modal,
  Skeletons,
  Stat,
  StatGrid,
  StatusDot,
  SubNav,
  Toast,
  useToast,
} from "../ui";
import "./admin.css";

const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Согласование с числом: «1 сессия», «2 сессии», «5 сессий» (§ UI-copy). */
const plural = (n: number, one: string, few: string, many: string): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

/** Словари каналов входа и причин завершения — из общего контракта (П-5). */
const VIA_LABELS = SESSION_VIA_LABELS;
const REVOKE_LABELS = SESSION_REVOKE_REASON_LABELS;

const SECTION_ITEMS: { key: AdminSection; label: string; icon: IconName }[] = [
  { key: "overview", label: "Обзор", icon: "dashboard" },
  { key: "devices", label: "Устройства", icon: "monitor" },
  { key: "roles", label: "Роли", icon: "shield" },
  { key: "network", label: "Сеть", icon: "wifi" },
  { key: "audit", label: "Аудит", icon: "doc" },
  { key: "policy", label: "Политики", icon: "lock" },
];

const failText = (e: unknown, fallback: string): string => (e instanceof SchoolApiError ? e.message : fallback);

export function AdminScreen({ section }: { section: string }) {
  const { can } = useSession();
  const me = useMe();
  const active: AdminSection = (ADMIN_SECTIONS as readonly string[]).includes(section) ? (section as AdminSection) : "overview";

  /* Кабинет принадлежит одной роли (AR-186): остальным — причина словами и
     дорога на свой экран, а не пустая страница и не молчаливый редирект. */
  if (!can("school.admin")) {
    return (
      <EmptyState
        testId="S-62.forbidden"
        title="Раздел доступен администратору школы"
        hint="Сеть, устройства, права и политики доступа ведёт администратор. Модератору открыт кабинет модератора, завучу — кабинет завуча."
        action={
          <Button kind="primary" onClick={() => navigate(me.startScreen)}>
            На стартовый экран
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="sch-page-head">
        <h1>Кабинет администратора</h1>
      </div>
      <SubNav
        testId="S-62.subnav"
        items={SECTION_ITEMS}
        active={active}
        onChange={(k) => navigate(k === "overview" ? "/admin" : `/admin/${k}`)}
      />
      {active === "overview" ? <OverviewSection /> : null}
      {active === "devices" ? <DevicesSection /> : null}
      {active === "roles" ? <RolesSection /> : null}
      {active === "network" ? <NetworkSection /> : null}
      {active === "audit" ? <AuditSection /> : null}
      {active === "policy" ? <PolicySection /> : null}
    </>
  );
}

// ─────────────────────────── обзор ───────────────────────────

function OverviewSection() {
  const [state, reload] = useAsync(() => api.adminOverview());
  if (state.status === "loading") return <Skeletons count={4} kind="card" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const o = state.data;

  return (
    <div className="sch-adm-section">
      <StatGrid testId="S-62.overview.stats">
        <Stat value={o.membersTotal} label="люди" />
        <Stat value={o.activatedTotal} label="активированы" />
        <Stat value={o.activeSessions} label="живых сессий" />
        <Stat value={o.onlineSessions} label="в сети" tone={o.onlineSessions > 0 ? "success" : undefined} />
        <Stat value={o.pwaSessions} label="в приложении" />
      </StatGrid>

      <div className="sch-adm-cols">
        <div className="sch-card sch-stack" data-testid="S-62.overview.school">
          <div className="sch-row sch-row--between">
            <span className="sch-card-title">{o.schoolName}</span>
            <Badge muted>{SCHOOL_STATE_LABELS[o.state]}</Badge>
          </div>
          <dl className="sch-adm-kv">
            <dt>Часовой пояс</dt>
            <dd>{o.timezone}</dd>
            <dt>Сетей Wi-Fi</dt>
            <dd>{o.networks}</dd>
            <dt>Устройств</dt>
            <dd>{o.assets}</dd>
            {o.policy.incidentAt ? (
              <>
                <dt>Инцидент-режим</dt>
                <dd>
                  {dateTime(o.policy.incidentAt)}
                  {o.policy.incidentByName ? `, ${o.policy.incidentByName}` : ""}
                </dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="sch-card sch-stack" data-testid="S-62.overview.pending">
          <span className="sch-card-title">Не авторизованные: {o.pendingActivations}</span>
          {o.pendingActivations === 0 ? (
            <span className="sch-muted">Все авторизованы</span>
          ) : (
            <LinkRow
              icon="users"
              label="К списку ожидающих"
              hint="активации выдаёт модератор"
              onClick={() => navigate("/moderator")}
            />
          )}
        </div>
      </div>

      <div>
        <h2 className="sch-section-title">Переходы</h2>
        <div className="sch-list--rows" data-testid="S-62.overview.links">
          <LinkRow icon="school" label="Кабинет модератора" hint="классы, предметы, персонал, расписание" onClick={() => navigate("/moderator")} />
          <LinkRow icon="checklist" label="Кабинет завуча" hint="готовность учебного и кадрового контуров" onClick={() => navigate("/deputy")} />
          <LinkRow icon="staff" label="Персонал" hint="карточки сотрудников, роли, доступ" onClick={() => navigate("/staff")} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── устройства (AR-187) ───────────────────────────

function DevicesSection() {
  const [state, reload] = useAsync(() => api.adminDevices());
  /* Ссылка входа выдаётся с КАРТОЧКИ сотрудника (AR-189), а карта знает
     только `userId`: список персонала грузится один раз ради связки
     userId → cardId. Его отказ карту не ломает — исчезает только кнопка. */
  const [staffState] = useAsync(() => api.staff());
  const cardByUser = useMemo(() => {
    const m = new Map<string, string>();
    if (staffState.status === "ready") for (const c of staffState.data) if (c.userId) m.set(c.userId, c.id);
    return m;
  }, [staffState]);
  const [query, setQuery] = useState("");
  const [journalFor, setJournalFor] = useState<AdminDeviceUserDto | null>(null);
  const [links, setLinks] = useState<Record<string, LoginLinkDto>>({});
  const { toast, showToast } = useToast();

  if (state.status === "loading") return <Skeletons count={4} kind="card" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const map = state.data;

  if (map.users.length === 0) {
    return (
      <EmptyState
        testId="S-62.devices.empty"
        title="В школе нет ни одной учётки"
        hint="Карта подключений появится, когда модератор заведёт сотрудников"
        action={
          <Button kind="primary" onClick={() => navigate("/staff")}>
            К персоналу
          </Button>
        }
      />
    );
  }

  /* Фильтр — на клиенте (§10): карта на всю школу без него нечитаема, а
     сервера ради подстроки дёргать нечего — данные уже здесь. */
  const q = query.trim().toLowerCase();
  const users = q
    ? map.users.filter((u) => u.name.toLowerCase().includes(q) || (u.username ?? "").toLowerCase().includes(q))
    : map.users;

  return (
    <div className="sch-adm-section">
      <p className="sch-adm-hint" data-testid="S-62.devices.summary">
        живых сессий {map.activeSessions}, в сети {map.onlineSessions}
      </p>
      <Field
        label="Поиск по карте"
        testId="S-62.devices.search"
        placeholder="ФИО или юзернейм"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {users.length === 0 ? (
        <p className="sch-muted">По запросу «{query.trim()}» никого нет</p>
      ) : (
        <div className="sch-adm-map">
          {users.map((u) => (
            <UserNode
              key={u.userId}
              user={u}
              cardId={cardByUser.get(u.userId) ?? null}
              link={links[u.userId] ?? null}
              onJournal={() => setJournalFor(u)}
              onLink={(l) => setLinks((prev) => ({ ...prev, [u.userId]: l }))}
              onChanged={reload}
              onError={showToast}
            />
          ))}
        </div>
      )}

      {journalFor ? <ConnectionsModal user={journalFor} onClose={() => setJournalFor(null)} /> : null}
      {toast ? <Toast text={toast} /> : null}
    </div>
  );
}

function UserNode({
  user,
  cardId,
  link,
  onJournal,
  onLink,
  onChanged,
  onError,
}: {
  user: AdminDeviceUserDto;
  cardId: string | null;
  link: LoginLinkDto | null;
  onJournal: () => void;
  onLink: (l: LoginLinkDto) => void;
  onChanged: () => void;
  onError: (t: string) => void;
}) {
  const [granting, setGranting] = useState(false);
  /* Дерево: прямой вход — потомок человека; сессия, выданная сканом с
     телефона, — потомок сессии телефона. Родитель, которого в живом списке
     уже нет, не делает сессию сиротой в разметке: она встаёт на верхний
     уровень с подписью, откуда пришла. */
  const ids = new Set(user.sessions.map((s) => s.id));
  const roots = user.sessions.filter((s) => !s.parentSessionId || !ids.has(s.parentSessionId));
  const childrenOf = (id: string) => user.sessions.filter((s) => s.parentSessionId === id);

  const renderTree = (nodes: AdminSessionDto[]) => (
    <ul className="sch-adm-tree">
      {nodes.map((s) => (
        <li key={s.id}>
          <SessionNode session={s} orphan={Boolean(s.parentSessionId) && !ids.has(s.parentSessionId ?? "")} onChanged={onChanged} onError={onError} />
          {childrenOf(s.id).length > 0 ? renderTree(childrenOf(s.id)) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="sch-card sch-adm-user"
      data-testid="S-62.devices.user"
      data-activated={user.activated ? "true" : "false"}
      data-deactivated={user.deactivated ? "true" : undefined}
    >
      <div className="sch-adm-user-head">
        <Avatar name={user.name} url={user.avatarUrl} />
        <div className="sch-adm-user-text">
          <span className="sch-adm-user-name">{user.name}</span>
          <div className="sch-adm-user-roles">
            {user.roles.map((r) => (
              <Badge key={r} muted>
                {ROLE_LABELS[r]}
              </Badge>
            ))}
            {user.deactivated ? <Badge tone="danger">деактивирован</Badge> : null}
            {!user.activated ? <Badge tone="warning">не активирован</Badge> : null}
          </div>
          {user.username ? <span className="sch-muted">{user.username}</span> : null}
        </div>
      </div>

      {user.sessions.length === 0 ? <span className="sch-muted">устройств нет</span> : renderTree(roots)}

      <div className="sch-adm-user-foot">
        <Button kind="ghost" testId="S-62.devices.btn.journal" onClick={onJournal}>
          Журнал подключений
        </Button>
        {/* «Выдать вход» — только у штатной учётки с карточкой (реестр S-62):
            ссылка выдаётся карточкой, и без неё выдавать нечем. */}
        {cardId ? (
          <Button
            kind="secondary"
            testId="S-62.devices.btn.grant"
            loading={granting}
            onClick={async () => {
              setGranting(true);
              try {
                onLink(await api.staffLoginLink(cardId));
              } catch (e) {
                onError(failText(e, "Не удалось выдать ссылку для входа"));
              } finally {
                setGranting(false);
              }
            }}
          >
            Выдать вход
          </Button>
        ) : null}
      </div>

      {link ? (
        <div className="sch-adm-link" data-testid="S-62.devices.link">
          <div className="sch-stack">
            <CopyField label="Ссылка для входа" value={`${window.location.origin}/bootstrap/${link.token}`} />
            {/* Дефолты ссылки (AR-204): 48 часов, без лимита открытий — параметры выбирают на `S-31`. */}
            <span className="sch-muted">
              действует до {dateTime(link.expiresAt)},{" "}
              {link.maxUses === null ? "без лимита открытий" : `использований ${link.useCount} из ${link.maxUses}`}
            </span>
          </div>
          <div className="sch-qr-frame">
            <QRCodeSVG value={`${window.location.origin}/bootstrap/${link.token}`} size={160} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionNode({
  session,
  orphan,
  onChanged,
  onError,
}: {
  session: AdminSessionDto;
  orphan: boolean;
  onChanged: () => void;
  onError: (t: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const live = session.status === "active";
  return (
    <div
      className="sch-adm-session"
      data-testid="S-62.devices.session"
      data-status={session.status}
      data-parent={session.parentSessionId ?? undefined}
      data-new-network={session.newNetwork ? "true" : undefined}
    >
      <div className="sch-adm-session-head">
        <div className="sch-adm-session-title">
          <span>{session.deviceHint}</span>
          <Badge muted>{SESSION_CLIENT_LABELS[session.clientKind]}</Badge>
          {session.newNetwork ? <Badge tone="warning">новая сеть</Badge> : null}
        </div>
        {/* Завершить можно только живую сессию: у завершённой кнопки нет,
            а не «серая» — нечего завершать (§4). */}
        {live && !session.current ? (
          <Button
            kind="danger"
            testId="S-62.devices.btn.revoke"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.adminRevokeSession(session.id);
                onChanged();
              } catch (e) {
                onError(failText(e, "Не удалось завершить сессию"));
              } finally {
                setBusy(false);
              }
            }}
          >
            Завершить
          </Button>
        ) : null}
      </div>
      <div className="sch-adm-session-meta">
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
        <span>{VIA_LABELS[session.via]}</span>
        {session.ip ? <span className="sch-muted">{session.ip}</span> : null}
        {orphan ? <span className="sch-muted">подключена с телефона</span> : null}
      </div>
    </div>
  );
}

/** `M-29` · журнал подключений человека за 90 дней: живые и завершённые. */
function ConnectionsModal({ user, onClose }: { user: AdminDeviceUserDto; onClose: () => void }) {
  const [state, reload] = useAsync(() => api.adminConnections(user.userId), [user.userId]);
  return (
    <Modal title={`Подключения: ${user.name}`} width={640} onClose={onClose} testId="M-29" mobile="fullscreen">
      {/* Контейнер списка стоит во всех трёх состояниях: реестр называет список,
          а не строки, и читатель (смок, человек) находит его сразу, не дожидаясь ответа. */}
      <div className="sch-list--rows" data-testid="M-29.list" data-state={state.status}>
        {state.status === "loading" ? <Skeletons count={3} kind="row" /> : null}
        {state.status === "error" ? <ErrorState message={state.message} onRetry={reload} /> : null}
        {state.status === "ready" && state.data.length === 0 ? <p className="sch-muted">Подключений не было</p> : null}
        {state.status === "ready"
          ? state.data.map((s) => (
            <div key={s.id} className="sch-adm-session" data-status={s.status}>
              <div className="sch-adm-session-title">
                <span>{dateTime(s.createdAt)}</span>
                <span>{s.deviceHint}</span>
                <Badge muted>{SESSION_CLIENT_LABELS[s.clientKind]}</Badge>
              </div>
              <div className="sch-adm-session-meta">
                <span>{VIA_LABELS[s.via]}</span>
                {s.ip ? <span>{s.ip}</span> : null}
                <span>
                  {s.status === "active" ? (
                    <>
                      <StatusDot tone={s.online ? "success" : "muted"} />
                      {s.online ? "в сети" : `активность: ${dateTime(s.lastSeenAt)}`}
                    </>
                  ) : (
                    <>
                      <StatusDot tone="muted" />
                      {s.revokedReason ? REVOKE_LABELS[s.revokedReason] : "истекла"}
                      {s.revokedAt ? `, ${dateTime(s.revokedAt)}` : ""}
                    </>
                  )}
                </span>
              </div>
            </div>
          ))
          : null}
      </div>
    </Modal>
  );
}

// ─────────────────────────── роли (AR-35) ───────────────────────────

const PERMISSION_GROUPS: { label: string; codes: readonly SchoolPermission[] }[] = [
  { label: "изменения", codes: MUTATION_PERMISSIONS },
  { label: "чтение", codes: READ_PERMISSIONS },
  { label: "проекции", codes: PROJECTION_PERMISSIONS },
  { label: "надзор", codes: OVERSIGHT_PERMISSIONS },
];

function RolesSection() {
  const mobile = useIsMobile();
  return (
    <div className="sch-adm-section">
      <p className="sch-adm-hint">
        Матрица собрана из пакета прав в коде и здесь только читается: право роли меняется решением, а не кнопкой.
      </p>
      {/* На мобайле — карточка на роль, а не таблица (§6): семнадцать колонок
          на 390px читаются только скроллом, а карточка перечисляет права роли
          по тем же группам. Контейнер тот же — реестр называет матрицу. */}
      {mobile ? (
        <div className="sch-list" data-testid="S-62.roles.matrix">
          {SCHOOL_ROLES.map((role) => {
            const groups = PERMISSION_GROUPS.map((g) => ({
              label: g.label,
              codes: g.codes.filter((code) => ROLE_PERMISSIONS[role].includes(code)),
            })).filter((g) => g.codes.length > 0);
            return (
              <div key={role} className="sch-card sch-adm-role">
                <div className="sch-card-title">{ROLE_LABELS[role]}</div>
                {groups.length === 0 ? <span className="sch-muted">прав нет</span> : null}
                {groups.map((g) => (
                  <div key={g.label} className="sch-adm-role-group">
                    <span className="sch-adm-role-group-label">{g.label}</span>
                    <span className="sch-adm-role-codes">{g.codes.join(", ")}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
      <div className="sch-tablewrap">
        <table className="sch-table sch-adm-matrix" data-testid="S-62.roles.matrix">
          <thead>
            <tr>
              <th rowSpan={2}>Роль</th>
              {PERMISSION_GROUPS.map((g) => (
                <th key={g.label} colSpan={g.codes.length} className="sch-adm-group sch-adm-group-start">
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {PERMISSION_GROUPS.flatMap((g) =>
                g.codes.map((code, i) => (
                  <th key={code} className={i === 0 ? "sch-adm-perm sch-adm-group-start" : "sch-adm-perm"}>
                    {/* Поворачивается внутренний span, а не th: рамка группы остаётся на неповёрнутой ячейке. */}
                    <span>{code}</span>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {SCHOOL_ROLES.map((role) => (
              <tr key={role}>
                <td>{ROLE_LABELS[role]}</td>
                {PERMISSION_GROUPS.flatMap((g) =>
                  g.codes.map((code, i) => {
                    const yes = ROLE_PERMISSIONS[role].includes(code);
                    return (
                      <td
                        key={code}
                        className={`sch-adm-cell${yes ? " sch-adm-cell--yes" : ""}${i === 0 ? " sch-adm-group-start" : ""}`}
                        title={`${ROLE_LABELS[role]}, ${code}: ${yes ? "есть" : "нет"}`}
                      >
                        {yes ? <Icon name="check" size={18} /> : null}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <dl className="sch-adm-legend" data-testid="S-62.roles.legend">
        <dt>school.admin</dt>
        <dd>кабинет администратора: сеть, устройства, права, аудит, политики</dd>
        <dt>school.manage</dt>
        <dd>кабинет модератора: классы, предметы, персонал, расписание</dd>
        <dt>school.oversee</dt>
        <dd>кабинет завуча: сводки готовности без единой мутации</dd>
        <dt>*.read</dt>
        <dd>чтение разделов — у всех штатных ролей; diary.read — проекция ученика и родителя</dd>
      </dl>
    </div>
  );
}

// ─────────────────────────── сеть и устройства ───────────────────────────

const ASSET_ICONS: Record<AssetKind, IconName> = {
  printer: "printer",
  scanner: "scan",
  computer: "laptop",
  projector: "monitor",
  router: "network",
  other: "monitor",
};

type RegistryTarget = { mode: "network"; record: SchoolNetworkDto | null } | { mode: "asset"; record: SchoolAssetDto | null };
type DeleteTarget = { kind: "network"; record: SchoolNetworkDto } | { kind: "asset"; record: SchoolAssetDto };

function NetworkSection() {
  const [state, reload] = useAsync(async () => {
    const [networks, assets] = await Promise.all([api.networks(), api.assets()]);
    return { networks, assets };
  });
  const [form, setForm] = useState<RegistryTarget | null>(null);
  const [del, setDel] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast, showToast } = useToast();

  if (state.status === "loading") return <Skeletons count={4} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const { networks, assets } = state.data;
  const ssidOf = (id: string | null) => networks.find((n) => n.id === id)?.ssid ?? null;

  const modal = form ? (
    <RegistryModal
      target={form}
      networks={networks}
      onClose={() => setForm(null)}
      onSaved={() => {
        setForm(null);
        reload();
      }}
    />
  ) : null;

  if (networks.length === 0 && assets.length === 0) {
    return (
      <>
        <EmptyState
          testId="S-62.network.empty"
          title="Сети и устройства не заведены"
          hint="Реестр Wi-Fi и корпоративных устройств — справочник школы: что где стоит и в какой сети"
          action={
            <Button kind="primary" testId="S-62.network.btn.addWifi" onClick={() => setForm({ mode: "network", record: null })}>
              Добавить сеть
            </Button>
          }
        />
        {modal}
      </>
    );
  }

  return (
    <div className="sch-adm-section">
      <section>
        <div className="sch-adm-head">
          <h2 className="sch-section-title">Wi-Fi</h2>
          <Button kind="primary" testId="S-62.network.btn.addWifi" onClick={() => setForm({ mode: "network", record: null })}>
            Добавить сеть
          </Button>
        </div>
        <div className="sch-list--rows" data-testid="S-62.network.wifi">
          {networks.length === 0 ? <p className="sch-muted">Сетей нет</p> : null}
          {networks.map((n) => (
            <div key={n.id} className="sch-adm-item" data-testid="S-62.network.item" data-kind="network">
              <span className="sch-adm-item-icon">
                <Icon name="wifi" />
              </span>
              <div className="sch-adm-item-body">
                <div className="sch-adm-item-title">
                  <strong>{n.ssid}</strong>
                  <Badge muted>{NETWORK_AUDIENCE_LABELS[n.audience]}</Badge>
                </div>
                {n.note ? <span className="sch-adm-item-sub">{n.note}</span> : null}
              </div>
              <div className="sch-adm-item-actions">
                <Button kind="ghost" testId="S-62.network.btn.edit" onClick={() => setForm({ mode: "network", record: n })}>
                  Изменить
                </Button>
                <Button kind="danger" testId="S-62.network.btn.delete" onClick={() => setDel({ kind: "network", record: n })}>
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="sch-adm-head">
          <h2 className="sch-section-title">Устройства</h2>
          <Button kind="secondary" testId="S-62.network.btn.addAsset" onClick={() => setForm({ mode: "asset", record: null })}>
            Добавить устройство
          </Button>
        </div>
        <div className="sch-list--rows" data-testid="S-62.network.assets">
          {assets.length === 0 ? <p className="sch-muted">Устройств нет</p> : null}
          {assets.map((a) => {
            const ssid = ssidOf(a.networkId);
            const sub = [ASSET_KIND_LABELS[a.kind], a.location, ssid ? `сеть ${ssid}` : null].filter(Boolean).join(", ");
            return (
              <div key={a.id} className="sch-adm-item" data-testid="S-62.network.item" data-kind="asset">
                <span className="sch-adm-item-icon">
                  <Icon name={ASSET_ICONS[a.kind]} />
                </span>
                <div className="sch-adm-item-body">
                  <div className="sch-adm-item-title">
                    <strong>{a.name}</strong>
                  </div>
                  <span className="sch-adm-item-sub">{sub}</span>
                </div>
                <div className="sch-adm-item-actions">
                  <Button kind="ghost" testId="S-62.network.btn.edit" onClick={() => setForm({ mode: "asset", record: a })}>
                    Изменить
                  </Button>
                  <Button kind="danger" testId="S-62.network.btn.delete" onClick={() => setDel({ kind: "asset", record: a })}>
                    Удалить
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {modal}

      {/* M-13 — подтверждение удаления называет объект (AR-105). */}
      {del ? (
        <Modal
          title="Подтверждение"
          width={400}
          onClose={() => setDel(null)}
          testId="M-13"
          mobile="sheet"
          level={2}
          footer={
            <div className="sch-actions">
              <Button kind="ghost" onClick={() => setDel(null)}>
                Отмена
              </Button>
              <Button
                kind="danger"
                loading={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    if (del.kind === "network") await api.deleteNetwork(del.record.id);
                    else await api.deleteAsset(del.record.id);
                    setDel(null);
                    reload();
                  } catch (e) {
                    setDel(null);
                    showToast(failText(e, "Не удалось удалить запись"));
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                Удалить
              </Button>
            </div>
          }
        >
          <p>
            {del.kind === "network"
              ? `Удалить сеть «${del.record.ssid}» из реестра? Устройства, привязанные к ней, останутся в реестре без сети.`
              : `Удалить устройство «${del.record.name}» из реестра?`}
          </p>
        </Modal>
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </div>
  );
}

/** Нативный выбор в раскладке поля: тот же класс, что у ввода, — форма читается одним ритмом. */
function SelectField({
  label,
  testId,
  value,
  onValue,
  children,
}: {
  label: string;
  testId?: string;
  value: string;
  onValue: (v: string) => void;
  children: ReactNode;
}) {
  const id = `sel-${testId ?? label}`;
  return (
    <div className="sch-field">
      <label className="sch-field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="sch-input" data-testid={testId} value={value} onChange={(e) => onValue(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

/**
 * `M-27` · одна форма на два вида записей реестра: поля сети либо устройства.
 * Один компонент, а не два: у обоих видов одинаковый цикл «поле → сохранить
 * → отказ словами под первым полем», и расходиться им не на чем.
 */
function RegistryModal({
  target,
  networks,
  onClose,
  onSaved,
}: {
  target: RegistryTarget;
  networks: SchoolNetworkDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const net = target.mode === "network" ? target.record : null;
  const asset = target.mode === "asset" ? target.record : null;
  const [ssid, setSsid] = useState(net?.ssid ?? "");
  const [audience, setAudience] = useState<NetworkAudience>(net?.audience ?? "staff");
  const [name, setName] = useState(asset?.name ?? "");
  const [kind, setKind] = useState<AssetKind>(asset?.kind ?? "printer");
  const [networkId, setNetworkId] = useState(asset?.networkId ?? "");
  const [location, setLocation] = useState(asset?.location ?? "");
  const [note, setNote] = useState((target.mode === "network" ? net?.note : asset?.note) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(target.record);

  const title =
    target.mode === "network" ? (editing ? "Сеть" : "Новая сеть") : editing ? "Устройство" : "Новое устройство";

  const save = async () => {
    setError(null);
    if (target.mode === "network" && !ssid.trim()) return setError("Укажите SSID сети");
    if (target.mode === "asset" && !name.trim()) return setError("Укажите название устройства");
    setBusy(true);
    try {
      if (target.mode === "network") {
        const dto = { ssid: ssid.trim(), audience, note: note.trim() || null };
        if (net) await api.updateNetwork(net.id, dto);
        else await api.createNetwork(dto);
      } else {
        const dto = {
          name: name.trim(),
          kind,
          networkId: networkId || null,
          location: location.trim() || null,
          note: note.trim() || null,
        };
        if (asset) await api.updateAsset(asset.id, dto);
        else await api.createAsset(dto);
      }
      onSaved();
    } catch (e) {
      setError(failText(e, "Не удалось сохранить запись"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      width={480}
      onClose={onClose}
      testId="M-27"
      mobile="fullscreen"
      footer={
        <div className="sch-actions">
          <Button kind="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button kind="primary" testId="M-27.btn.save" loading={busy} onClick={save}>
            Сохранить
          </Button>
        </div>
      }
    >
      {target.mode === "network" ? (
        <>
          <Field label="SSID сети" testId="M-27.input.ssid" value={ssid} onChange={(e) => setSsid(e.target.value)} error={error} autoFocus />
          <SelectField label="Для кого" testId="M-27.select.audience" value={audience} onValue={(v) => setAudience(v as NetworkAudience)}>
            {NETWORK_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {NETWORK_AUDIENCE_LABELS[a]}
              </option>
            ))}
          </SelectField>
        </>
      ) : (
        <>
          <Field label="Название" testId="M-27.input.name" value={name} onChange={(e) => setName(e.target.value)} error={error} autoFocus />
          <SelectField label="Тип" testId="M-27.select.kind" value={kind} onValue={(v) => setKind(v as AssetKind)}>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {ASSET_KIND_LABELS[k]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Сеть" testId="M-27.select.network" value={networkId} onValue={setNetworkId}>
            <option value="">не указана</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.ssid}
              </option>
            ))}
          </SelectField>
          <Field label="Где стоит" testId="M-27.input.location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </>
      )}
      <Field label="Заметка" testId="M-27.input.note" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

// ─────────────────────────── аудит (AR-30) ───────────────────────────

function AuditSection() {
  const [state, reload] = useAsync(() => api.adminAudit());
  const mobile = useIsMobile();
  if (state.status === "loading") return <Skeletons count={4} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const entries = state.data;

  if (entries.length === 0) {
    return <EmptyState testId="S-62.audit.empty" title="Действий пока нет" hint="Здесь появится журнал действий всей школы: дата, кто, действие, объект" />;
  }

  /* На мобайле — карточки, а не таблица (§6): четыре колонки на 390px дают
     горизонтальный скролл там, где строка и так короткая. */
  if (mobile) {
    return (
      <div className="sch-list" data-testid="S-62.audit">
        {entries.map((e) => (
          <div className="sch-card" key={e.id}>
            <div className="sch-card-title">{e.actionLabel}</div>
            <div className="sch-card-sub">{e.objectName ?? e.objectKind}</div>
            <div className="sch-muted">
              {dateTime(e.at)}
              {e.actorName ? `, ${e.actorName}` : ""}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="sch-tablewrap">
      <table className="sch-table sch-adm-audit" data-testid="S-62.audit">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Кто</th>
            <th>Действие</th>
            <th>Объект</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{dateTime(e.at)}</td>
              <td>{e.actorName ?? <span className="sch-muted">система</span>}</td>
              <td title={e.action}>{e.actionLabel}</td>
              <td>{e.objectName ?? e.objectKind}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────── политики (AR-188, AR-205) ───────────────────────────

const LIMIT_OPTIONS = [1, 2, 3, 5, 10];

const limitsToForm = (limits: SessionLimits): Record<SchoolRole, string> => {
  const out = {} as Record<SchoolRole, string>;
  for (const r of SCHOOL_ROLES) {
    const v = limits[r];
    out[r] = typeof v === "number" ? String(v) : "";
  }
  return out;
};

/**
 * Лимит носителей роли (AR-205) в форме — три состояния, а не два: `""` — не
 * задано (действует дефолт `DEFAULT_ROLE_LIMITS`: 1 у директора и обоих
 * замов, без лимита у остальных), `ROLE_LIMIT_NONE` — администратор снял лимит
 * явно (`null`), число — лимит. Различать «не задано» и «снято» нужно только
 * ролям с дефолтом: у остальных это одно и то же, и явный `null` сервера
 * сворачивается в `""`.
 */
const ROLE_LIMIT_NONE = "none";
type RoleLimitForm = Partial<Record<SchoolRole, string>>;
const hasRoleDefault = (role: SchoolRole): boolean => typeof DEFAULT_ROLE_LIMITS[role] === "number";

const roleLimitsToForm = (limits: RoleLimits): RoleLimitForm => {
  const out: RoleLimitForm = {};
  for (const r of STAFF_ROLES) {
    const v = limits[r];
    if (typeof v === "number") out[r] = String(v);
    else if (v === null && hasRoleDefault(r)) out[r] = ROLE_LIMIT_NONE;
    else out[r] = "";
  }
  return out;
};

/** Словарь для `PUT /admin/policy`: у ролей с дефолтом «не задано» — ключа нет, у остальных — `null`. */
const formToRoleLimits = (form: RoleLimitForm): RoleLimits => {
  const out: RoleLimits = {};
  for (const r of STAFF_ROLES) {
    const v = form[r] ?? "";
    if (v === ROLE_LIMIT_NONE) out[r] = null;
    else if (v !== "") out[r] = Number(v);
    else if (!hasRoleDefault(r)) out[r] = null;
  }
  return out;
};

function PolicySection() {
  const [state, reload, patch] = useAsync(async () => {
    const [policy, overview] = await Promise.all([api.adminPolicy(), api.adminOverview()]);
    return { policy, overview };
  });
  /* После инцидента данные перечитываются ТИХО (patch, без `status: "loading"`):
     `reload` размонтировал бы PolicyBody скелетонами вместе со строкой
     «Закрыто N сессий…», ради которой инцидент и подтверждали. */
  const refresh = async () => {
    const [policy, overview] = await Promise.all([api.adminPolicy(), api.adminOverview()]);
    patch({ policy, overview });
  };
  if (state.status === "loading") return <Skeletons count={3} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  return (
    <PolicyBody
      policy={state.data.policy}
      overview={state.data.overview}
      onPolicy={(policy) => patch({ policy, overview: state.data.overview })}
      onIncident={refresh}
    />
  );
}

function PolicyBody({
  policy,
  overview,
  onPolicy,
  onIncident,
}: {
  policy: AccessPolicyDto;
  overview: AdminOverviewDto;
  onPolicy: (p: AccessPolicyDto) => void;
  onIncident: () => Promise<void>;
}) {
  const [form, setForm] = useState<Record<SchoolRole, string>>(() => limitsToForm(policy.sessionLimits));
  const [roleForm, setRoleForm] = useState<RoleLimitForm>(() => roleLimitsToForm(policy.roleLimits ?? {}));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [incidentBusy, setIncidentBusy] = useState(false);
  const [incidentResult, setIncidentResult] = useState<IncidentResultDto | null>(null);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  /* Живых сессий, кроме этой: ноль — закрывать нечего, кнопка выключена словами (§4). */
  const others = Math.max(0, overview.activeSessions - 1);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const sessionLimits: SessionLimits = {};
      for (const r of SCHOOL_ROLES) sessionLimits[r] = form[r] === "" ? null : Number(form[r]);
      /* Одна кнопка — оба словаря (AR-205): политика принимается целиком. */
      const next = await api.setAdminPolicy({ sessionLimits, roleLimits: formToRoleLimits(roleForm) });
      /* «Сохранить» — и данные меняются: форма перечитывается из ответа
         сервера, а не из того, что нажали (§ UI-copy: один глагол на действие
         и результат). Тост здесь был бы шумом. */
      setForm(limitsToForm(next.sessionLimits));
      setRoleForm(roleLimitsToForm(next.roleLimits ?? {}));
      onPolicy(next);
      setSaved(true);
    } catch (e) {
      setError(failText(e, "Не удалось сохранить политику"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sch-adm-section">
      <div className="sch-card sch-stack">
        <h2 className="sch-section-title">Лимиты: сессии и носители ролей</h2>
        <p className="sch-adm-hint">
          Сессий на человека — число либо без лимита: превышение закрывает самую старую сессию, а не отказывает во входе.
          Носителей роли в школе — сколько людей могут нести роль: когда занято столько, сколько разрешено, заведение
          карточки, выдача роли и возврат доступа отклоняются; директор и оба заместителя по умолчанию — по одному.
        </p>
        {/* Сетка в три колонки (AR-205): роль · сессий на человека · носителей роли в школе. */}
        <div className="sch-adm-limits" data-testid="S-62.policy.limits">
          <span className="sch-adm-limits-head">Роль</span>
          <span className="sch-adm-limits-head">Сессий на человека</span>
          <span className="sch-adm-limits-head">Носителей роли в школе</span>
          {SCHOOL_ROLES.map((role) => {
            const cur = form[role];
            const extra = cur !== "" && !LIMIT_OPTIONS.includes(Number(cur)) ? Number(cur) : null;
            return (
              <LimitRow
                key={role}
                role={role}
                value={cur}
                extra={extra}
                onValue={(v) => setForm((f) => ({ ...f, [role]: v }))}
                roleValue={roleForm[role] ?? ""}
                taken={policy.roleHolders?.[role] ?? 0}
                onRoleValue={(v) => setRoleForm((f) => ({ ...f, [role]: v }))}
              />
            );
          })}
        </div>
        {error ? (
          <span className="sch-field-error" role="alert">
            {error}
          </span>
        ) : null}
        <div className="sch-row">
          <Button kind="primary" testId="S-62.policy.btn.save" loading={saving} onClick={save}>
            Сохранить
          </Button>
          {saved ? <span className="sch-adm-saved">Сохранено</span> : null}
          {policy.updatedAt && !saved ? <span className="sch-muted">обновлено {dateTime(policy.updatedAt)}</span> : null}
        </div>
      </div>

      <div className="sch-card sch-stack sch-adm-incident" data-testid="S-62.policy.incident">
        <h2 className="sch-section-title">Инцидент-режим</h2>
        <p className="sch-adm-hint">
          Закрывает все живые сессии школы, кроме этой. Люди входят заново по QR, коду или паролю; учётки и пароли остаются.
        </p>
        <span className="sch-muted">
          {policy.incidentAt
            ? `последний раз: ${dateTime(policy.incidentAt)}${policy.incidentByName ? `, ${policy.incidentByName}` : ""}`
            : "не применялся"}
        </span>
        {incidentResult ? (
          <span className="sch-success-text">
            Закрыто {incidentResult.revoked} {plural(incidentResult.revoked, "сессия", "сессии", "сессий")} у{" "}
            {incidentResult.users} {plural(incidentResult.users, "человека", "человека", "человек")}
          </span>
        ) : null}
        {others === 0 ? <span className="sch-muted">Кроме этой, живых сессий нет</span> : null}
        {incidentError ? (
          <span className="sch-field-error" role="alert">
            {incidentError}
          </span>
        ) : null}
        <div className="sch-actions sch-actions--start">
          <Button kind="danger" testId="S-62.policy.btn.incident" disabled={others === 0} onClick={() => setConfirm(true)}>
            Закрыть все сессии школы
          </Button>
        </div>
      </div>

      {/* M-28 — подтверждение называет число живых сессий (§3). */}
      {confirm ? (
        <Modal
          title="Инцидент-режим"
          width={440}
          onClose={() => setConfirm(false)}
          testId="M-28"
          mobile="sheet"
          footer={
            <div className="sch-actions">
              <Button kind="ghost" onClick={() => setConfirm(false)}>
                Отмена
              </Button>
              <Button
                kind="danger"
                testId="M-28.btn.confirm"
                loading={incidentBusy}
                onClick={async () => {
                  setIncidentBusy(true);
                  try {
                    const r = await api.adminIncident();
                    setIncidentResult(r);
                    setIncidentError(null);
                    setConfirm(false);
                    /* Сессии уже закрыты: отказ тихого перечитывания строку
                       результата не прячет — счётчики догонят при следующем
                       обновлении, а сам отказ здесь никому не нужен словами. */
                    await onIncident().catch(() => undefined);
                  } catch (e) {
                    setConfirm(false);
                    setIncidentError(failText(e, "Не удалось закрыть сессии"));
                  } finally {
                    setIncidentBusy(false);
                  }
                }}
              >
                Закрыть все сессии
              </Button>
            </div>
          }
        >
          <p data-testid="M-28.text">
            Закрыть {others} {plural(others, "живую сессию", "живые сессии", "живых сессий")} школы, кроме этой? Люди войдут заново по QR, коду или паролю.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/**
 * Строка сетки лимитов: роль · сессий на человека (`limit-{role}`, AR-188) ·
 * носителей роли в школе (`role-limit-{role}` в ячейке `S-62.policy.roleLimits`,
 * AR-205). Второй селект — только у штатных ролей: у родителя и ученика
 * носителей не ограничивают, и ячейка говорит это словами, а не пустотой.
 */
function LimitRow({
  role,
  value,
  extra,
  onValue,
  roleValue,
  taken,
  onRoleValue,
}: {
  role: SchoolRole;
  value: string;
  extra: number | null;
  onValue: (v: string) => void;
  roleValue: string;
  taken: number;
  onRoleValue: (v: string) => void;
}) {
  const id = `limit-${role}`;
  const roleId = `role-limit-${role}`;
  const staff = STAFF_ROLES.includes(role);
  const withDefault = hasRoleDefault(role);
  const roleExtra = roleValue !== "" && roleValue !== ROLE_LIMIT_NONE && !LIMIT_OPTIONS.includes(Number(roleValue)) ? Number(roleValue) : null;
  return (
    <>
      <label htmlFor={id}>{ROLE_LABELS[role]}</label>
      <div className="sch-adm-limit-cell">
        <span className="sch-adm-limits-cap" aria-hidden="true">
          сессий на человека
        </span>
        <select id={id} className="sch-input" aria-label={`${ROLE_LABELS[role]}: сессий на человека`} value={value} onChange={(e) => onValue(e.target.value)}>
          <option value="">без лимита</option>
          {/* Значение вне ряда (задано раньше иначе) не теряется молча — стоит своим пунктом. */}
          {extra !== null ? <option value={String(extra)}>{extra}</option> : null}
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {staff ? (
        <div className="sch-adm-limit-cell" data-testid="S-62.policy.roleLimits">
          <span className="sch-adm-limits-cap" aria-hidden="true">
            носителей роли в школе
          </span>
          <div className="sch-adm-rolelimit">
            <select
              id={roleId}
              className="sch-input"
              aria-label={`${ROLE_LABELS[role]}: носителей роли в школе`}
              value={roleValue}
              onChange={(e) => onRoleValue(e.target.value)}
            >
              {/* У директора и замов пустое значение — дефолт «1 (по умолчанию)» (AR-205);
                  снятие лимита у них — отдельный явный пункт. */}
              <option value="">{withDefault ? `${DEFAULT_ROLE_LIMITS[role]} (по умолчанию)` : "без лимита"}</option>
              {withDefault ? <option value={ROLE_LIMIT_NONE}>без лимита</option> : null}
              {roleExtra !== null ? <option value={String(roleExtra)}>{roleExtra}</option> : null}
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
            {/* Занято — живые членства плюс пустые слоты (то же число, что видит проверка сервера). */}
            <span className="sch-adm-rolelimit-taken">занято {taken}</span>
          </div>
        </div>
      ) : (
        <span className="sch-adm-hint">не ограничивается</span>
      )}
    </>
  );
}
