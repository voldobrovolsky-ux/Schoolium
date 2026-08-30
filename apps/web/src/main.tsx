import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/design/styles.css";
import "@/admin/ds/ds.css";
import { PrefsProvider } from "@/app/prefs";
import { AppShell } from "@/app/AppShell";
import { AdminApp } from "@/admin/AdminApp";
import {
  CurrentUserProvider,
  useCurrentUser,
  resolveCabinet,
  type CurrentUser,
  type CabinetKey,
  type FlorRole,
  type SubRole,
} from "@/cabinets/CurrentUser";
import { MINIMAL_CABINETS, type MinimalKey } from "@/cabinets/roleRegistry";
import { MinimalCabinet } from "@/cabinets/MinimalCabinet";
import { RoleSwitch } from "@/cabinets/RoleSwitch";
import { Home } from "@/home/Home";
import { BindConfirm } from "@/home/BindConfirm";
import { PilotOwner } from "@/pilot/PilotOwner";
import { PilotLogin } from "@/pilot/PilotLogin";
import { SchooliumApp } from "@/schoolium/SchooliumApp";
import { isAppPath, PUBLIC_PATHS } from "@/schoolium/router";

// Роутинг кабинета по роли (ADR-0005). teacher и admin — готовые кабинеты,
// остальные роли — минимальные кабинеты (навигация + главная).
function Shell() {
  const { user } = useCurrentUser();
  // §5.1: кабинет из каталога (бэкенд /me); resolveCabinet — fallback для DEV/без ответа.
  const cab = user.cabinet ?? resolveCabinet(user.florusRole, user.subRole);
  if (cab === "admin") return <AdminApp />;
  if (cab === "teacher") return <AppShell />;
  return <MinimalCabinet def={MINIMAL_CABINETS[cab as MinimalKey]} user={user} />;
}

function AuthedApp({ initialUser }: { initialUser?: CurrentUser }) {
  return (
    <CurrentUserProvider initialUser={initialUser}>
      <PrefsProvider>
        <Shell />
      </PrefsProvider>
      {!import.meta.env.PROD && <RoleSwitch />}
    </CurrentUserProvider>
  );
}

type Gate = { status: "loading" } | { status: "anon" } | { status: "authed"; user?: CurrentUser };

interface MeResp {
  florusUserId: string;
  name: string;
  role: FlorRole;
  subRole: SubRole;
  orgName?: string;
  cabinet?: CabinetKey; // §5.1: кабинет из каталога прав
  permissions?: string[];
}

/**
 * Гейт входа. ПРОД: спрашивает сессию (/api/auth/flor/me); есть — кабинет, нет — главная
 * (лендинг/киоск). DEV: по умолчанию кабинет (DEFAULT_USER + RoleSwitch); главную можно
 * посмотреть через ?screen=home.
 */
function useAuthGate(): Gate {
  const [gate, setGate] = useState<Gate>(() =>
    import.meta.env.PROD ? { status: "loading" } : { status: "authed" },
  );
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    fetch("/api/auth/flor/me", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<MeResp>) : null))
      .then((m) =>
        setGate(
          m
            ? {
                status: "authed",
                user: {
                  name: m.name,
                  florusRole: m.role,
                  subRole: m.subRole,
                  orgName: m.orgName ?? "Школа",
                  cabinet: m.cabinet, // §5.1: из каталога
                  permissions: m.permissions,
                },
              }
            : { status: "anon" },
        ),
      )
      .catch(() => setGate({ status: "anon" }));
  }, []);
  return gate;
}

const PENDING_BIND = "edustore-pending-bind";

/**
 * Граница двух контуров (AR-83, AR-84): Schoolium 1.1.1 и вытесняемый кабинет
 * КТП/КПП живут в одном приложении, но не в одном сценарии. Правило разделения
 * ОДНО и проверяется здесь, а не в каждом экране:
 *
 *   1. пилотные и legacy query-маршруты (`?pilot=`, `?bind=`, `?screen=`)
 *      принадлежат старому контуру — он появился первым и его смок (G-9) их
 *      использует;
 *   2. пути Schoolium — контуру 1.1.1;
 *   3. корень `/` — контуру 1.1.1 (AR-95: первая точка входа на сайт), кроме
 *      браузера с ЖИВОЙ legacy-сессией: его владелец пришёл в свой кабинет, а
 *      не на лендинг. Различить контуры даёт `GET /api/v1/me`, который
 *      отвечает только сессии 1.1.1.
 */
function isSchooliumRoute(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("pilot") || params.get("bind") || params.get("screen")) return false;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (
    isAppPath(path) ||
    PUBLIC_PATHS.includes(path) ||
    path.startsWith("/join/") ||
    path.startsWith("/bootstrap/") ||
    path.startsWith("/login/code/")   // код входа ссылкой из QR (В1)
  );
}

function Root() {
  const gate = useAuthGate();
  const params = new URLSearchParams(window.location.search);
  const bind = params.get("bind");

  // ВРЕМЕННЫЙ пилотный auth (AUTH_MODE=pilot-qr): owner-экран и QR-вход — публичные роуты.
  const pilot = params.get("pilot");
  if (pilot === "owner") return <PilotOwner />;
  if (pilot === "login") return <PilotLogin token={params.get("token") ?? ""} />;

  // Маршруты Schoolium, КРОМЕ корня: он решается ниже, после ответа гейта.
  if (isSchooliumRoute() && window.location.pathname.replace(/\/+$/, "") !== "") return <SchooliumApp />;

  // DEV-превью главной без входа.
  if (!import.meta.env.PROD && params.get("screen") === "home") return <Home />;

  if (gate.status === "loading") return <div className="eds-admin home-boot" />;

  // Привязка устройства с телефона (?bind=CODE) — требует входа.
  if (bind) {
    if (gate.status === "authed") return <BindConfirm code={bind} />;
    try {
      sessionStorage.setItem(PENDING_BIND, bind); // довяжем после входа
    } catch {
      /* ignore */
    }
    return <Home banner="Войдите в кабинет, чтобы привязать устройство" />;
  }

  if (gate.status === "authed") {
    // вернулись со входа с отложенной привязкой — завершаем её
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_BIND);
      if (pending) sessionStorage.removeItem(PENDING_BIND);
    } catch {
      /* ignore */
    }
    if (pending) return <BindConfirm code={pending} />;
    // Живая legacy-сессия на корне — её кабинет; лендинг Schoolium ей не нужен.
    return <AuthedApp initialUser={gate.user} />;
  }

  // Корень без legacy-сессии принадлежит Schoolium: лендинг `S-00` для анонима,
  // стартовый экран роли — для того, у кого есть сессия 1.1.1.
  return <SchooliumApp />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// PWA: регистрируем service worker (офлайн-кеш журнала/расписания/материалов).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
