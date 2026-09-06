/**
 * `S-62` · раздел «Разрешения» (AR-214). Матрица прав перестала быть таблицей
 * для чтения: администратор школы правит её тумблером, и правка ДЕЙСТВУЕТ —
 * тот же резолв читают гейт роутов и `GET /v1/me`.
 *
 * Раскладка объясняется задачей, а не вкусом:
 *   · разделы приложения — правым сайдбаром: их семь, они не меняются, и
 *     выбранный раздел задаёт содержимое всей рабочей области;
 *   · рабочая область — от верха до низа между сайдбарами: девять ролей ×
 *     функции раздела не помещаются в колонку страницы;
 *   · уровень разрешений (общие / индивидуальные) — за иконкой настроек в
 *     углу сайдбара: это переключатель режима, а не восьмой раздел, и в
 *     списке разделов он читался бы как ещё один раздел приложения.
 *
 * Правило отката: тумблер применяется оптимистично и возвращается на место,
 * если сервер отказал, — с текстом отказа в тосте (AR-40). Молчаливого
 * расхождения экрана с сервером не остаётся ни на один кадр.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APP_SECTIONS,
  PERMISSION_LABELS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_SHORT_LABELS,
  SCHOOL_ROLES,
  isLockedRoleGrant,
  type AppSectionKey,
  type PermissionMatrixDto,
  type PermissionUserDto,
  type SchoolPermission,
  type SchoolRole,
  type UserPermissionsDto,
} from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile } from "../hooks";
import { Icon, type IconName } from "../icons";
import { useSession } from "../session";
import { Avatar, Badge, Button, ErrorState, Skeletons, Toast, Toggle, useToast } from "../ui";
import "./permissions.css";

/** Выбор пережигает перезагрузку: администратор возвращается туда, где был. */
const KEY_SECTION = "schoolium.perm.section";
const KEY_MODE = "schoolium.perm.mode";
const KEY_USER = "schoolium.perm.user";

type Mode = "common" | "individual";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* приватный режим — просто не запоминаем выбор */
  }
};

const SECTION_ICONS: Record<AppSectionKey, IconName> = {
  journal: "journal",
  schedule: "calendar",
  classes: "classes",
  subjects: "subjects",
  staff: "staff",
  diary: "student",
  cabinets: "shieldCheck",
};

const failText = (e: unknown, fallback: string): string => (e instanceof SchoolApiError ? e.message : fallback);

export function PermissionsSection() {
  const mobile = useIsMobile();
  const { reload: reloadSession, state: session } = useSession();
  const { toast, showToast } = useToast();

  const [section, setSection] = useState<AppSectionKey>(() => {
    const saved = read(KEY_SECTION);
    return APP_SECTIONS.some((s) => s.key === saved) ? (saved as AppSectionKey) : APP_SECTIONS[0].key;
  });
  const [mode, setMode] = useState<Mode>(() => (read(KEY_MODE) === "individual" ? "individual" : "common"));
  const [userId, setUserId] = useState<string | null>(() => read(KEY_USER));
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => write(KEY_SECTION, section), [section]);
  useEffect(() => write(KEY_MODE, mode), [mode]);
  useEffect(() => write(KEY_USER, userId), [userId]);

  const [matrix, reloadMatrix, setMatrix] = useAsync(() => api.permissionMatrix());
  const [person, reloadPerson, setPerson] = useAsync(
    () => (userId ? api.userPermissions(userId) : Promise.resolve(null)),
    [userId],
  );

  const def = APP_SECTIONS.find((s) => s.key === section) ?? APP_SECTIONS[0];
  const codes = def.permissions as readonly SchoolPermission[];

  /* Право себе самому меняется тем же запросом, что и всем: значит и
     собственная сессия обязана перечитаться — иначе экран администратора
     остаётся с прошлым набором кнопок до перезагрузки. Задето своё, если
     правили СВОЮ роль либо СЕБЯ адресно. */
  const refreshOwn = useCallback(
    (touched: string) => {
      if (session.status !== "authed") return;
      const roles: readonly string[] = session.me.roles;
      if (touched === session.me.userId || roles.includes(touched)) void reloadSession();
    },
    [session, reloadSession],
  );

  const toggleRole = async (role: SchoolRole, permission: SchoolPermission, next: boolean) => {
    if (matrix.status !== "ready") return;
    const key = `${role}:${permission}`;
    const before = matrix.data;
    setBusy(key);
    setMatrix(optimisticRole(before, role, permission, next));
    try {
      setMatrix(await api.setRolePermission({ role, permission, allowed: next }));
      refreshOwn(role);
    } catch (e) {
      setMatrix(before);
      showToast(failText(e, "Разрешение изменить не удалось"));
    } finally {
      setBusy(null);
    }
  };

  const toggleUser = async (permission: SchoolPermission, next: boolean) => {
    if (person.status !== "ready" || !person.data || !userId) return;
    const before = person.data;
    setBusy(permission);
    setPerson(optimisticUser(before, permission, next));
    try {
      /* Совпало с пакетом ролей — отклонение СНИМАЕТСЯ (`null`), а не пишется
         дублем: иначе человек молча заморозил бы старое право при правке роли. */
      const allowed = before.base.includes(permission) === next ? null : next;
      setPerson(await api.setUserPermission(userId, { permission, allowed }));
      refreshOwn(userId);
    } catch (e) {
      setPerson(before);
      showToast(failText(e, "Разрешение изменить не удалось"));
    } finally {
      setBusy(null);
    }
  };

  const chosen = person.status === "ready" ? person.data : null;

  const main =
    mode === "common" ? (
      <CommonMatrix state={matrix} codes={codes} busy={busy} onToggle={toggleRole} onRetry={reloadMatrix} mobile={mobile} />
    ) : (
      <IndividualMatrix
        state={person}
        codes={codes}
        busy={busy}
        chosen={userId}
        onToggle={toggleUser}
        onRetry={reloadPerson}
        onPick={() => setPanel(true)}
      />
    );

  return (
    <div className="sch-perm" data-mode={mode}>
      <section className="sch-perm-main">
        <header className="sch-perm-head">
          <div className="sch-perm-title">
            <span className="sch-perm-icon">
              <Icon name={SECTION_ICONS[def.key]} size={20} />
            </span>
            <div>
              <h2>{def.label}</h2>
              <p className="sch-perm-hint">{def.hint}</p>
            </div>
          </div>
          {mode === "individual" && chosen ? (
            <div className="sch-perm-who" data-testid="S-62.perm.who">
              <Avatar name={chosen.user.name} url={chosen.user.avatarUrl} />
              <span className="sch-perm-who-text">
                <span className="sch-perm-who-name">{chosen.user.name}</span>
                <span className="sch-perm-who-roles">{chosen.user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</span>
              </span>
              {chosen.user.deactivated ? <Badge tone="danger">деактивирован</Badge> : null}
            </div>
          ) : null}
        </header>
        {main}
        <dl className="sch-perm-legend" data-testid="S-62.roles.legend">
          <dt>Тумблер</dt>
          <dd>меняет разрешение сразу: следующий запрос этого человека сервер проверит уже по нему</dd>
          <dt>Ободок</dt>
          <dd>разрешение задано школой поверх пакета роли версии — снимите тумблер обратно, и правка уйдёт</dd>
          <dt>Общие</dt>
          <dd>разрешения роли: действуют на всех её носителей в школе</dd>
          <dt>Индивидуальные</dt>
          <dd>разрешения одного человека поверх его ролей: «выдано лично» и «снято лично»</dd>
          <dt>Замок</dt>
          <dd>«Кабинет администратора» у роли администратора не снимается: снявший закрыл бы кабинет сам себе</dd>
        </dl>
      </section>

      <aside className="sch-perm-side" data-testid="S-62.perm.sections">
        <div className="sch-perm-side-head">
          <span className="sch-perm-side-title">Разделы</span>
          <Button
            kind="icon"
            testId="S-62.perm.btn.mode"
            aria-label="Уровень разрешений"
            aria-expanded={panel}
            onClick={() => setPanel((v) => !v)}
          >
            <Icon name="settings" />
          </Button>
        </div>
        <nav className="sch-perm-nav" aria-label="Разделы приложения">
          {APP_SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="sch-perm-nav-item"
              data-testid="S-62.perm.section"
              data-key={s.key}
              aria-current={s.key === section ? "true" : undefined}
              onClick={() => setSection(s.key)}
            >
              <span className="sch-perm-nav-icon">
                <Icon name={SECTION_ICONS[s.key]} size={18} />
              </span>
              <span className="sch-perm-nav-label">{s.label}</span>
              <span className="sch-perm-nav-count">{s.permissions.length}</span>
            </button>
          ))}
        </nav>

        <div className="sch-perm-side-foot">
          <span className="sch-perm-side-foot-label">Уровень</span>
          <span className="sch-perm-side-foot-value" data-testid="S-62.perm.level">
            {mode === "common" ? "Общие: разрешения роли" : chosen ? chosen.user.name : "Индивидуальные: человек не выбран"}
          </span>
        </div>

        <ModePanel
          open={panel}
          mode={mode}
          chosen={userId}
          onCommon={() => {
            setMode("common");
            setPanel(false);
          }}
          onIndividual={() => setMode("individual")}
          onPick={(u) => {
            setUserId(u.userId);
            setMode("individual");
            setPanel(false);
          }}
          onClose={() => setPanel(false)}
        />
      </aside>

      {toast ? <Toast text={toast} /> : null}
    </div>
  );
}

// ─────────────────────────── общие разрешения ───────────────────────────

function CommonMatrix({
  state,
  codes,
  busy,
  onToggle,
  onRetry,
  mobile,
}: {
  state: ReturnType<typeof useAsync<PermissionMatrixDto>>[0];
  codes: readonly SchoolPermission[];
  busy: string | null;
  onToggle: (role: SchoolRole, permission: SchoolPermission, next: boolean) => void;
  onRetry: () => void;
  mobile: boolean;
}) {
  if (state.status === "loading") return <Skeletons count={4} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={onRetry} />;
  const { grants, overrides } = state.data;

  /* На телефоне матрица разворачивается в карточку на функцию: девять колонок
     на 390px читаются только скроллом, а тумблер обязан попадать под палец. */
  if (mobile) {
    return (
      <div className="sch-perm-cards" data-testid="S-62.roles.matrix">
        {codes.map((code) => (
          <div key={code} className="sch-card sch-perm-card">
            <span className="sch-card-title">{PERMISSION_LABELS[code]}</span>
            <span className="sch-perm-code">{code}</span>
            {SCHOOL_ROLES.map((role) => (
              <div key={role} className="sch-perm-card-row" data-role={role} data-perm={code}>
                <span>{ROLE_LABELS[role]}</span>
                <RoleToggle role={role} code={code} grants={grants} overrides={overrides} busy={busy} onToggle={onToggle} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="sch-perm-scroll">
      <div
        className="sch-perm-grid"
        data-testid="S-62.roles.matrix"
        style={{ "--perm-cols": SCHOOL_ROLES.length } as React.CSSProperties}
      >
        <div className="sch-perm-cell sch-perm-cell--corner">Функция</div>
        {SCHOOL_ROLES.map((role) => (
          <div key={role} className="sch-perm-cell sch-perm-cell--col" title={ROLE_LABELS[role]}>
            {ROLE_SHORT_LABELS[role]}
          </div>
        ))}
        {codes.map((code) => (
          <div className="sch-perm-row" key={code}>
            <div className="sch-perm-cell sch-perm-cell--head">
              <span className="sch-perm-fn">{PERMISSION_LABELS[code]}</span>
              <span className="sch-perm-code">{code}</span>
            </div>
            {SCHOOL_ROLES.map((role) => (
              <div key={role} className="sch-perm-cell sch-perm-cell--switch" data-role={role} data-perm={code}>
                <RoleToggle role={role} code={code} grants={grants} overrides={overrides} busy={busy} onToggle={onToggle} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleToggle({
  role,
  code,
  grants,
  overrides,
  busy,
  onToggle,
}: {
  role: SchoolRole;
  code: SchoolPermission;
  grants: PermissionMatrixDto["grants"];
  overrides: PermissionMatrixDto["overrides"];
  busy: string | null;
  onToggle: (role: SchoolRole, permission: SchoolPermission, next: boolean) => void;
}) {
  const on = (grants[role] ?? []).includes(code);
  const locked = isLockedRoleGrant(role, code);
  const own = overrides[role]?.[code] !== undefined;
  return (
    <Toggle
      checked={on}
      disabled={locked}
      busy={busy === `${role}:${code}`}
      tone={own ? "own" : "default"}
      testId="S-62.perm.toggle"
      label={
        locked
          ? `${ROLE_LABELS[role]}, ${PERMISSION_LABELS[code]}: снять нельзя — кабинет администратора`
          : `${ROLE_LABELS[role]}, ${PERMISSION_LABELS[code]}: ${on ? "разрешено" : "запрещено"}`
      }
      onChange={(next) => onToggle(role, code, next)}
    />
  );
}

// ─────────────────────────── индивидуальные разрешения ───────────────────────────

function IndividualMatrix({
  state,
  codes,
  busy,
  chosen,
  onToggle,
  onRetry,
  onPick,
}: {
  state: ReturnType<typeof useAsync<UserPermissionsDto | null>>[0];
  codes: readonly SchoolPermission[];
  busy: string | null;
  chosen: string | null;
  onToggle: (permission: SchoolPermission, next: boolean) => void;
  onRetry: () => void;
  onPick: () => void;
}) {
  if (!chosen) {
    return (
      <div className="sch-perm-empty" data-testid="S-62.perm.empty">
        <span className="sch-perm-empty-icon">
          <Icon name="users" size={24} />
        </span>
        <p>Человек не выбран</p>
        <span className="sch-muted">Индивидуальные разрешения показываются для одного человека школы</span>
        <Button kind="primary" onClick={onPick}>
          Выбрать человека
        </Button>
      </div>
    );
  }
  if (state.status === "loading") return <Skeletons count={4} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={onRetry} />;
  if (!state.data) return <ErrorState message="Человек не найден в школе" onRetry={onRetry} />;
  const { base, effective, overrides } = state.data;

  return (
    /* Одна колонка вместо девяти — и карточка сужается вместе с ней: матрица
       на всю ширину страницы ради единственного тумблера справа заставляла бы
       глаз пробегать метр пустоты между функцией и её состоянием. */
    <div className="sch-perm-scroll sch-perm-scroll--one">
      <div className="sch-perm-grid sch-perm-grid--one" data-testid="S-62.perm.user" style={{ "--perm-cols": 1 } as React.CSSProperties}>
        <div className="sch-perm-cell sch-perm-cell--corner">Функция</div>
        <div className="sch-perm-cell sch-perm-cell--col">Разрешено</div>
        {codes.map((code) => {
          const on = effective.includes(code);
          const own = overrides[code] !== undefined;
          return (
            <div className="sch-perm-row" key={code}>
              <div className="sch-perm-cell sch-perm-cell--head">
                <span className="sch-perm-fn">{PERMISSION_LABELS[code]}</span>
                {/* Откуда состояние: пакет ролей или адресная правка — иначе
                    «включено» ничего не говорит о том, переживёт ли оно смену роли. */}
                <span className="sch-perm-src">
                  {own ? (overrides[code] ? "выдано лично" : "снято лично") : base.includes(code) ? "от роли" : "нет у роли"}
                </span>
              </div>
              <div className="sch-perm-cell sch-perm-cell--switch" data-perm={code}>
                <Toggle
                  checked={on}
                  busy={busy === code}
                  tone={own ? "own" : "default"}
                  testId="S-62.perm.toggle"
                  label={`${PERMISSION_LABELS[code]}: ${on ? "разрешено" : "запрещено"}`}
                  onChange={(next) => onToggle(code, next)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────── полоска уровня разрешений ───────────────────────────

/**
 * Полоска вылетает из-под иконки настроек влево. В «общих» это две мишени —
 * уровень разрешений; выбор «индивидуальных» превращает ту же полоску в
 * строку поиска со списком людей под ней: выбирать человека больше негде, и
 * второго места для этого заводить не нужно.
 */
function ModePanel({
  open,
  mode,
  chosen,
  onCommon,
  onIndividual,
  onPick,
  onClose,
}: {
  open: boolean;
  mode: Mode;
  chosen: string | null;
  onCommon: () => void;
  onIndividual: () => void;
  onPick: (u: PermissionUserDto) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  /* Грузится при раскрытии, а не при входе в раздел: закрытая полоска не
     должна стоить запроса, а раскрытая обязана показывать сегодняшний состав —
     человека могли завести минуту назад. */
  const [users, reloadUsers] = useAsync(
    () => (open ? api.permissionUsers(null) : Promise.resolve<PermissionUserDto[] | null>(null)),
    [open],
  );

  // Полоска — не слой: она не забирает фокус и не затемняет экран. Поэтому
  // закрытие держится здесь, а не Radix: `Esc` и клик мимо (§3 — гарантии слоя
  // нужны модалке, а не всплывающей панели внутри раздела).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open && mode === "individual") search.current?.focus();
  }, [open, mode]);

  const list = useMemo(() => {
    if (users.status !== "ready" || !users.data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return users.data;
    return users.data.filter((u) => u.name.toLowerCase().includes(q) || (u.username ?? "").toLowerCase().includes(q));
  }, [users, query]);

  return (
    <div className="sch-perm-panel" data-open={open || undefined} data-shape={mode} ref={box} data-testid="S-62.perm.panel">
      {mode === "common" ? (
        <div className="sch-perm-strip" role="group" aria-label="Уровень разрешений">
          <button
            type="button"
            className="sch-perm-strip-btn"
            data-testid="S-62.perm.btn.common"
            aria-current="true"
            title="Общие: разрешения роли"
            onClick={onCommon}
          >
            <Icon name="users" size={18} />
            <span>Общие</span>
          </button>
          <button
            type="button"
            className="sch-perm-strip-btn"
            data-testid="S-62.perm.btn.individual"
            title="Индивидуальные: разрешения одного человека"
            onClick={onIndividual}
          >
            <Icon name="staff" size={18} />
            <span>Индивидуальные</span>
          </button>
        </div>
      ) : (
        <>
          <div className="sch-perm-search">
            <button type="button" className="sch-perm-back" aria-label="К уровню разрешений" onClick={onCommon}>
              <Icon name="chevronLeft" size={18} />
            </button>
            <span className="sch-perm-search-icon">
              <Icon name="search" size={18} />
            </span>
            <input
              ref={search}
              className="sch-perm-search-input"
              data-testid="S-62.perm.search"
              placeholder="ФИО или юзернейм"
              aria-label="Поиск человека"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="sch-perm-users" data-testid="S-62.perm.users" data-state={users.status}>
            {users.status === "loading" ? <Skeletons count={4} kind="row" /> : null}
            {users.status === "error" ? <ErrorState message={users.message} onRetry={reloadUsers} /> : null}
            {users.status === "ready" && users.data && list.length === 0 ? <p className="sch-muted">Никого не найдено</p> : null}
            {list.map((u) => (
              <button
                key={u.userId}
                type="button"
                className="sch-perm-user"
                data-testid="S-62.perm.user.item"
                aria-current={u.userId === chosen ? "true" : undefined}
                onClick={() => onPick(u)}
              >
                <Avatar name={u.name} url={u.avatarUrl} />
                <span className="sch-perm-user-text">
                  <span className="sch-perm-user-name">{u.name}</span>
                  <span className="sch-perm-user-roles">{u.roles.map((r) => ROLE_SHORT_LABELS[r]).join(", ")}</span>
                </span>
                {u.deactivated ? <Badge muted>снят</Badge> : null}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────── оптимистичное состояние ───────────────────────────

function optimisticRole(m: PermissionMatrixDto, role: SchoolRole, code: SchoolPermission, next: boolean): PermissionMatrixDto {
  const grant = new Set(m.grants[role] ?? []);
  if (next) grant.add(code);
  else grant.delete(code);
  /* Правило сервера повторяется здесь дословно: вернулись к пакету версии —
     отклонения больше нет. Иначе ободок «правка школы» вспыхивал бы на кадр
     и гас ответом — мигание там, где ничего не произошло. */
  const ov = { ...(m.overrides[role] ?? {}) };
  if (ROLE_PERMISSIONS[role].includes(code) === next) delete ov[code];
  else ov[code] = next;
  return { grants: { ...m.grants, [role]: [...grant] }, overrides: { ...m.overrides, [role]: ov } };
}

function optimisticUser(p: UserPermissionsDto, code: SchoolPermission, next: boolean): UserPermissionsDto {
  const eff = new Set(p.effective);
  if (next) eff.add(code);
  else eff.delete(code);
  const overrides = { ...p.overrides };
  if (p.base.includes(code) === next) delete overrides[code];
  else overrides[code] = next;
  return { ...p, effective: [...eff], overrides };
}
