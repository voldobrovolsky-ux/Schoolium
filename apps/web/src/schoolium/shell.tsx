/**
 * Навигационная оболочка (AR-81, `75-adaptive.md` §2) — ДВЕ раскладки одной
 * модели: десктоп (≥768px) — левый сайдбар 240px со сворачиванием до 72 и
 * топбар 64px; мобайл (<768px) — хедер 56px и нижний таб-бар 64px + safe-area.
 *
 * Три правила, которые здесь не «оформление», а решение:
 *   · «Кабинет» виден ТОЛЬКО модератору — не «серый и некликабельный», а
 *     отсутствует (AR-69). На мобайле он иконка в хедере, а НЕ шестая вкладка:
 *     пять вкладок одинаковы для всех шести ролей, иначе два человека,
 *     обсуждая продукт по телефону, видят разное меню (§2.2);
 *   · сайдбар не скрывается при открытии модалки — он уходит под блюр вместе с
 *     контентом; скролл только в контентной области;
 *   · таб-бар уходит под полноэкранный поток и возвращается по его завершении
 *     (§2.2) — признак ставит сам слой, оболочка его только читает.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ROLE_LABELS, type SchoolRole } from "@edustore/shared";
import { Avatar, Button, PopoverOrSheet } from "./ui";
import { useIsMobile } from "./hooks";
import { useSession } from "./session";
import { navigate } from "./router";

const COLLAPSE_KEY = "schoolium.sidebar.collapsed";

/** Пять разделов — одинаковых для всех шести ролей (AR-81). */
const NAV: { key: string; path: string; label: string; glyph: string }[] = [
  { key: "classes", path: "/classes", label: "Классы", glyph: "▣" },
  { key: "subjects", path: "/subjects", label: "Предметы", glyph: "◈" },
  { key: "staff", path: "/staff", label: "Персонал", glyph: "☰" },
  { key: "schedule", path: "/schedule", label: "Расписание", glyph: "▦" },
  { key: "journal", path: "/journal", label: "Журнал", glyph: "✎" },
];

export interface ShellProps {
  active: string;
  title: string;
  breadcrumb?: { label: string; to: string; current: string } | null;
  children: ReactNode;
}

export function Shell({ active, title, breadcrumb, children }: ShellProps) {
  const { state, logout } = useSession();
  const mobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [menu, setMenu] = useState<DOMRect | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* приватный режим — просто не запоминаем выбор */
    }
  }, [collapsed]);

  if (state.status !== "authed") return null;
  const me = state.me;
  const isModerator = me.roles.includes("moderator");

  const userMenu = menu ? (
    /* M-15 — меню пользователя: поповер 240px на десктопе, нижний лист на
       мобайле (§3). До этапа 3 слой был собран здесь руками мимо библиотеки и
       не имел ни автофокуса, ни ловушки фокуса, ни возврата фокуса
       открывателю — трёх из четырёх общих правил §3. */
    <PopoverOrSheet
      label="Меню пользователя"
      width={240}
      anchor={menu}
      testId="M-15"
      onClose={() => setMenu(null)}
    >
      <div className="sch-stack">
        <Button
          kind="ghost"
          testId="M-15.devices"
          onClick={() => {
            setMenu(null);
            navigate("/settings/devices");
          }}
        >
          Устройства
        </Button>
        <Button kind="ghost" testId="M-15.logout" onClick={logout}>
          Выйти
        </Button>
      </div>
    </PopoverOrSheet>
  ) : null;

  if (mobile) {
    return (
      <div className="sch sch-shell sch-shell--mobile">
        <header className="sch-header">
          {/* Внутри класса и предмета заголовок — «‹ 5А» с возвратом (§2.2):
              на мобайле хлебные крошки не помещаются, и их роль берёт на себя
              заголовок, а не отдельная строка. */}
          {breadcrumb ? (
            <button
              className="sch-header-title sch-header-title--back"
              data-testid="L.header.title"
              onClick={() => navigate(breadcrumb.to)}
            >
              ‹ {breadcrumb.current}
            </button>
          ) : (
            <span className="sch-header-title" data-testid="L.header.title">
              {title}
            </span>
          )}
          <span className="sch-topbar-spacer" />
          {/* Кабинет модератора — иконка хедера, не вкладка (§2.2). */}
          {isModerator ? (
            <Button kind="icon" testId="L.header.admin" aria-label="Кабинет модератора" onClick={() => navigate("/admin")}>
              ⚙
            </Button>
          ) : null}
          {/* Сканер — всем, КРОМЕ модератора: он показывает коды, а не сканирует. */}
          {!isModerator ? (
            <Button kind="icon" testId="L.header.scan" aria-label="Сканер QR" onClick={() => navigate("/scan")}>
              ⛶
            </Button>
          ) : null}
          <button
            className="sch-header-user"
            data-testid="L.header.user"
            aria-label="Меню пользователя"
            onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          >
            <Avatar name={me.name} url={me.avatarUrl} />
          </button>
        </header>

        <main className="sch-content">
          <div className="sch-page">{children}</div>
        </main>

        <nav className="sch-tabbar" data-testid="L.tabbar">
          {NAV.map((n) => (
            <button
              key={n.key}
              className="sch-tab"
              data-testid={`L.tabbar.item.${n.key}`}
              aria-current={active === n.key ? "page" : undefined}
              onClick={() => navigate(n.path)}
            >
              <span className="sch-tab-icon" aria-hidden="true">
                {n.glyph}
              </span>
              <span className="sch-tab-label">{n.label}</span>
            </button>
          ))}
        </nav>

        {userMenu}
      </div>
    );
  }

  return (
    <div className="sch sch-shell">
      <nav className="sch-sidebar" data-collapsed={collapsed} data-testid="L.sidebar">
        <button className="sch-logo" data-testid="L.sidebar.logo" onClick={() => navigate(me.startScreen)}>
          {collapsed ? "S" : "Schoolium"}
        </button>
        <div className="sch-sidebar-sep" />
        <div className="sch-nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className="sch-nav-item"
              data-testid={`L.sidebar.item.${n.key}`}
              aria-current={active === n.key ? "page" : undefined}
              onClick={() => navigate(n.path)}
              title={collapsed ? n.label : undefined}
            >
              <span className="sch-nav-icon" aria-hidden="true">
                {n.glyph}
              </span>
              <span className="sch-nav-label">{n.label}</span>
            </button>
          ))}
          {/* Кабинет модератора: отсутствует у остальных ролей, а не задизейблен. */}
          {isModerator ? (
            <>
              <div className="sch-sidebar-sep" />
              <button
                className="sch-nav-item"
                data-testid="L.sidebar.item.admin"
                aria-current={active === "admin" ? "page" : undefined}
                onClick={() => navigate("/admin")}
                title={collapsed ? "Кабинет" : undefined}
              >
                <span className="sch-nav-icon" aria-hidden="true">
                  ⚙
                </span>
                <span className="sch-nav-label">Кабинет</span>
              </button>
            </>
          ) : null}
        </div>

        <button
          className="sch-user"
          data-testid="L.sidebar.user"
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
        >
          <Avatar name={me.name} url={me.avatarUrl} />
          <span className="sch-user-text">
            <span className="sch-user-name">{me.name}</span>
            <br />
            <span className="sch-user-roles">{me.roles.map((r) => ROLE_LABELS[r as SchoolRole]).join(', ')}</span>
          </span>
        </button>
        <Button
          kind="icon"
          testId="L.sidebar.collapse"
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "»" : "«"}
        </Button>
      </nav>

      <div className="sch-main">
        <header className="sch-topbar">
          <span className="sch-topbar-title" data-testid="L.topbar.title">
            {title}
          </span>
          {breadcrumb ? (
            <span className="sch-breadcrumb" data-testid="L.topbar.breadcrumb">
              <button onClick={() => navigate(breadcrumb.to)}>{breadcrumb.label}</button> / {breadcrumb.current}
            </span>
          ) : null}
          <span className="sch-topbar-spacer" />
          {/* Сканер — всем ролям, КРОМЕ модератора: он показывает коды, а не сканирует. */}
          {!isModerator ? (
            <Button kind="icon" testId="L.topbar.scan" aria-label="Сканер QR" onClick={() => navigate("/scan")}>
              ⛶
            </Button>
          ) : null}
        </header>
        <main className="sch-content">
          <div className="sch-page">{children}</div>
        </main>
      </div>

      {userMenu}
    </div>
  );
}
