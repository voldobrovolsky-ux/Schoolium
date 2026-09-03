/**
 * Навигационная оболочка (AR-81, `75-adaptive.md` §2) — ДВЕ раскладки одной
 * модели: десктоп (≥768px) — левый сайдбар 240px со сворачиванием до 72 и
 * топбар 64px; мобайл (<768px) — хедер 56px и нижний таб-бар 64px + safe-area.
 *
 * Правила, которые здесь не «оформление», а решение:
 *   · пять вкладок одинаковы для всех ролей (§2.2) — различие ролей выражается
 *     кабинетами под разделителем, а не разным меню;
 *   · кабинетов три (AR-186): администратора (`/admin`, право `school.admin`),
 *     модератора (`/moderator`, `school.manage`) и завуча (`/deputy`,
 *     `school.oversee`). Пункт, недоступный роли, не «серый», а отсутствует
 *     (AR-69). На мобайле — одна иконка хедера в старший кабинет; остальные —
 *     в меню пользователя `M-15`, шестой вкладки нет;
 *   · сайдбар не скрывается при открытии модалки — уходит под затемнение
 *     вместе с контентом; скролл только в контентной области;
 *   · таб-бар уходит под полноэкранный поток и возвращается по его завершении
 *     (§2.2) — признак ставит сам слой, оболочка его только читает;
 *   · иконки — `lucide` через `Icon` (AR-190), не юникод-глифы.
 */
import { useEffect, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ROLE_LABELS, type SchoolPermission, type SchoolRole } from "@edustore/shared";
import { Avatar, Button, Modal, PopoverOrSheet } from "./ui";
import { Icon, type IconName } from "./icons";
import { useIsMobile } from "./hooks";
import { useSession } from "./session";
import { navigate } from "./router";

const COLLAPSE_KEY = "schoolium.sidebar.collapsed";

/** Пять разделов — одинаковых для всех ролей (AR-81). */
const NAV: { key: string; path: string; label: string; icon: IconName }[] = [
  { key: "classes", path: "/classes", label: "Классы", icon: "classes" },
  { key: "subjects", path: "/subjects", label: "Предметы", icon: "subjects" },
  { key: "staff", path: "/staff", label: "Персонал", icon: "staff" },
  { key: "schedule", path: "/schedule", label: "Расписание", icon: "calendar" },
  { key: "journal", path: "/journal", label: "Журнал", icon: "journal" },
];

/**
 * Три кабинета по правам (AR-186). Порядок = старшинство: иконка хедера на
 * мобайле ведёт в первый доступный.
 */
export const CABINETS: { key: "admin" | "moderator" | "deputy"; path: string; label: string; short: string; icon: IconName; can: SchoolPermission }[] = [
  { key: "admin", path: "/admin", label: "Администрирование", short: "Админ", icon: "shieldCheck", can: "school.admin" },
  { key: "moderator", path: "/moderator", label: "Кабинет модератора", short: "Модератор", icon: "settings", can: "school.manage" },
  { key: "deputy", path: "/deputy", label: "Кабинет завуча", short: "Завуч", icon: "checklist", can: "school.oversee" },
];

export interface ShellProps {
  active: string;
  title: string;
  breadcrumb?: { label: string; to: string; current: string } | null;
  children: ReactNode;
}

export function Shell({ active, title, breadcrumb, children }: ShellProps) {
  const { state, logout, can } = useSession();
  const mobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [myQr, setMyQr] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* приватный режим — просто не запоминаем выбор */
    }
  }, [collapsed]);

  if (state.status !== "authed") return null;
  const me = state.me;
  const isTeacher = me.roles.includes("teacher");
  const cabinets = CABINETS.filter((c) => can(c.can));
  const primaryCabinet = cabinets[0] ?? null;

  const userMenu = menu ? (
    /* M-15 — меню пользователя: поповер 240px на десктопе, нижний лист на
       мобайле (§3). Кабинеты здесь — для мобайла, где в хедере одна иконка;
       на десктопе они же стоят в сайдбаре, и дубль не мешает: меню короткое. */
    <PopoverOrSheet label="Меню пользователя" width={240} anchor={menu} testId="M-15" onClose={() => setMenu(null)}>
      <div className="sch-menu">
        <div className="sch-menu-head">
          <Avatar name={me.name} url={me.avatarUrl} />
          <span className="sch-menu-who">
            <span className="sch-user-name">{me.name}</span>
            <span className="sch-user-roles">{me.roles.map((r) => ROLE_LABELS[r as SchoolRole]).join(", ")}</span>
          </span>
        </div>
        {/* «Мой QR» — над «Устройства» (AR-179): личный код педагога для
            «Управления компетенцией» модератора. */}
        {isTeacher ? (
          <button
            className="sch-menu-item"
            data-testid="M-15.myqr"
            onClick={() => {
              setMenu(null);
              setMyQr(true);
            }}
          >
            <Icon name="qr" size={18} />
            Мой QR
          </button>
        ) : null}
        {mobile
          ? cabinets.map((c) => (
              <button
                key={c.key}
                className="sch-menu-item"
                data-testid={`M-15.cabinet.${c.key}`}
                onClick={() => {
                  setMenu(null);
                  navigate(c.path);
                }}
              >
                <Icon name={c.icon} size={18} />
                {c.label}
              </button>
            ))
          : null}
        <button
          className="sch-menu-item"
          data-testid="M-15.settings"
          onClick={() => {
            setMenu(null);
            navigate("/settings");
          }}
        >
          <Icon name="settings" size={18} />
          Настройки и приложение
        </button>
        <button
          className="sch-menu-item"
          data-testid="M-15.devices"
          onClick={() => {
            setMenu(null);
            navigate("/settings/devices");
          }}
        >
          <Icon name="monitor" size={18} />
          Устройства и сессии
        </button>
        <div className="sch-menu-sep" />
        <button className="sch-menu-item sch-menu-item--danger" data-testid="M-15.logout" onClick={logout}>
          <Icon name="logout" size={18} />
          Выйти
        </button>
      </div>
    </PopoverOrSheet>
  ) : null;

  /* M-24 — личный QR педагога (AR-179): постоянная ссылка-идентификатор, не
     credential — компетенции применяет сессия модератора с `subject.write`. */
  const myQrModal = myQr ? (
    <Modal title="Мой QR" width={360} onClose={() => setMyQr(false)} testId="M-24" mobile="sheet">
      <div className="sch-qr">
        <div className="sch-qr-frame" data-testid="M-24.qr">
          <QRCodeSVG value={`${window.location.origin}/competence/${me.userId}`} size={240} />
        </div>
        <p className="sch-muted">Покажите модератору. Он привяжет вас к вашим предметам через «Управление компетенцией»</p>
      </div>
    </Modal>
  ) : null;

  if (mobile) {
    return (
      <div className="sch sch-shell sch-shell--mobile">
        <header className="sch-header">
          {/* Внутри класса и предмета заголовок — «‹ 5А» с возвратом (§2.2):
              на мобайле хлебные крошки не помещаются, и их роль берёт на себя
              заголовок, а не отдельная строка. */}
          {breadcrumb ? (
            <button className="sch-header-title sch-header-title--back" data-testid="L.header.title" onClick={() => navigate(breadcrumb.to)}>
              <Icon name="chevronLeft" size={20} />
              {breadcrumb.current}
            </button>
          ) : (
            <span className="sch-header-title" data-testid="L.header.title">
              {title}
            </span>
          )}
          <span className="sch-topbar-spacer" />
          {/* Сканер — ВСЕМ ролям, ЛЕВЕЕ кабинета (правка владельца 2026-08-31):
              модератор сканирует личный QR педагога для «Управления компетенцией». */}
          <Button kind="icon" testId="L.header.scan" aria-label="Сканер QR" onClick={() => navigate("/scan")}>
            <Icon name="scan" />
          </Button>
          {/* Старший кабинет — иконка хедера, не вкладка (§2.2); остальные в M-15. */}
          {primaryCabinet ? (
            <Button kind="icon" testId="L.header.admin" aria-label={primaryCabinet.label} onClick={() => navigate(primaryCabinet.path)}>
              <Icon name={primaryCabinet.icon} />
            </Button>
          ) : null}
          <button className="sch-header-user" data-testid="L.header.user" aria-label="Меню пользователя" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}>
            <Avatar name={me.name} url={me.avatarUrl} />
          </button>
        </header>

        <main className="sch-content">
          <div className="sch-page">{children}</div>
        </main>

        <nav className="sch-tabbar" data-testid="L.tabbar">
          {NAV.map((n) => (
            <button key={n.key} className="sch-tab" data-testid={`L.tabbar.item.${n.key}`} aria-current={active === n.key ? "page" : undefined} onClick={() => navigate(n.path)}>
              <span className="sch-tab-icon">
                <Icon name={n.icon} size={24} />
              </span>
              <span className="sch-tab-label">{n.label}</span>
            </button>
          ))}
        </nav>

        {userMenu}
        {myQrModal}
      </div>
    );
  }

  return (
    <div className="sch sch-shell">
      <nav className="sch-sidebar" data-collapsed={collapsed} data-testid="L.sidebar">
        {/* Под логотипом — только «Schoolium»: название школы снято решением владельца 2026-09-03. */}
        <button className="sch-logo" data-testid="L.sidebar.logo" onClick={() => navigate(me.startScreen)}>
          {collapsed ? "S" : "Schoolium"}
        </button>
        <div className="sch-sidebar-sep" />
        <div className="sch-nav">
          {NAV.map((n) => (
            <button key={n.key} className="sch-nav-item" data-testid={`L.sidebar.item.${n.key}`} aria-current={active === n.key ? "page" : undefined} onClick={() => navigate(n.path)} title={collapsed ? n.label : undefined}>
              <span className="sch-nav-icon">
                <Icon name={n.icon} />
              </span>
              <span className="sch-nav-label">{n.label}</span>
            </button>
          ))}
          {/* Кабинеты по правам (AR-186): отсутствуют у остальных ролей, а не задизейблены. */}
          {cabinets.length > 0 ? (
            <>
              <div className="sch-sidebar-sep" />
              {cabinets.map((c) => (
                <button
                  key={c.key}
                  className="sch-nav-item"
                  /* Литералы, а не шаблон: G-52 сверяет элементы оболочки буквально. */
                  data-testid={c.key === "admin" ? "L.sidebar.item.admin" : c.key === "moderator" ? "L.sidebar.item.moderator" : "L.sidebar.item.deputy"}
                  aria-current={active === c.key ? "page" : undefined}
                  onClick={() => navigate(c.path)}
                  title={collapsed ? c.label : undefined}
                >
                  <span className="sch-nav-icon">
                    <Icon name={c.icon} />
                  </span>
                  <span className="sch-nav-label">{c.label}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>

        <button className="sch-user" data-testid="L.sidebar.user" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}>
          <Avatar name={me.name} url={me.avatarUrl} />
          <span className="sch-user-text">
            <span className="sch-user-name">{me.name}</span>
            <span className="sch-user-roles">{me.roles.map((r) => ROLE_LABELS[r as SchoolRole]).join(", ")}</span>
          </span>
        </button>
        <Button kind="icon" testId="L.sidebar.collapse" aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"} onClick={() => setCollapsed((v) => !v)}>
          <Icon name={collapsed ? "expand" : "collapse"} />
        </Button>
      </nav>

      <div className="sch-main">
        <header className="sch-topbar">
          <span className="sch-topbar-title" data-testid="L.topbar.title">
            {title}
          </span>
          {breadcrumb ? (
            <span className="sch-breadcrumb" data-testid="L.topbar.breadcrumb">
              <button onClick={() => navigate(breadcrumb.to)}>{breadcrumb.label}</button>
              <Icon name="chevronRight" size={18} />
              {breadcrumb.current}
            </span>
          ) : null}
          <span className="sch-topbar-spacer" />
          {/* Сканер — ВСЕМ ролям (правка владельца 2026-08-31): модератору он
              нужен для личного QR педагога; десктоп объяснит, что сканирует телефон. */}
          <Button kind="icon" testId="L.topbar.scan" aria-label="Сканер QR" onClick={() => navigate("/scan")}>
            <Icon name="scan" />
          </Button>
        </header>
        <main className="sch-content">
          <div className="sch-page">{children}</div>
        </main>
      </div>

      {userMenu}
      {myQrModal}
    </div>
  );
}
