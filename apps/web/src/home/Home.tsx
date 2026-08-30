import { useCallback, useEffect, useRef, useState } from "react";
import "./home.css";
import { Landing } from "./Landing";
import { DeviceBind } from "./DeviceBind";
import { KioskLogin } from "./KioskLogin";
import { WaterOverlay } from "./WaterOverlay";
import {
  getDeviceToken,
  setDeviceToken,
  clearDeviceToken,
  rememberKioskUser,
} from "./deviceStore";

type Mode = "landing" | "bind" | "kiosk";
const CHORD = ["x", "r", "t", "j"] as const;

const ROLE_RU: Record<string, string> = {
  owner: "Учредитель",
  admin: "Администратор",
  teacher: "Учитель",
  staff: "Сотрудник",
  parent: "Родитель",
  student: "Ученик",
};
const SUB_RU: Record<string, string> = {
  zavuch: "Завуч",
  methodist: "Методист",
  psychologist: "Психолог",
};
const roleLabel = (role?: string, sub?: string | null): string =>
  role === "staff" && sub ? SUB_RU[sub] ?? "Сотрудник" : ROLE_RU[role ?? ""] ?? "Пользователь";

const initialMode = (): Mode => {
  if (getDeviceToken()) return "kiosk"; // привязанное устройство → сразу экран входа
  const p = new URLSearchParams(window.location.search);
  if (p.get("mode") === "kiosk") return "bind"; // надёжный фолбэк активации привязки
  return "landing";
};

/**
 * Главная edustore-flor-group.ru. Три режима: лендинг (1), привязка устройства (2),
 * вход на киоске (3). Переходы — плавные «водяные». Привязка активируется
 * комбинацией Ctrl+X+R+T+J, либо ?mode=kiosk, либо скрытой кнопкой (Ctrl+X конфликтует
 * с «вырезать», поэтому фолбэков несколько). См. ТЗ главной.
 */
export function Home({ banner }: { banner?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [fx, setFx] = useState(false);
  const fxTimer = useRef<number | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const go = useCallback((next: Mode) => {
    if (modeRef.current === next) return;
    setFx(true);
    if (fxTimer.current) window.clearTimeout(fxTimer.current);
    fxTimer.current = window.setTimeout(() => setFx(false), 780);
    setMode(next);
  }, []);

  const exitBind = useCallback(() => go(getDeviceToken() ? "kiosk" : "landing"), [go]);
  const toggleBind = useCallback(
    () => (modeRef.current === "bind" ? exitBind() : go("bind")),
    [go, exitBind],
  );

  // Тёмная тема в режиме киоска (экран работает постоянно — щадим его).
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "kiosk") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    return () => root.removeAttribute("data-theme");
  }, [mode]);

  // Перехват Ctrl+X+R+T+J (аккорд накапливается, пока зажат Ctrl) + Esc.
  useEffect(() => {
    const chord = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modeRef.current === "bind") exitBind();
        chord.clear();
        return;
      }
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (!CHORD.includes(k as (typeof CHORD)[number])) return;
      e.preventDefault(); // гасим побочный эффект Ctrl+X (вырезать)
      chord.add(k);
      if (CHORD.every((c) => chord.has(c))) {
        chord.clear();
        toggleBind();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || !e.ctrlKey) chord.clear();
    };
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
    };
  }, [toggleBind, exitBind]);

  const login = useCallback(() => {
    window.location.href = "/api/auth/flor/login";
  }, []);

  const onBound = useCallback(
    (token: string) => {
      setDeviceToken(token);
      go("kiosk");
    },
    [go],
  );

  const onUnbind = useCallback(() => {
    clearDeviceToken();
    go("landing");
  }, [go]);

  // Вход на киоске завершён (cookie уже стоит): запоминаем учителя и грузим кабинет.
  const onAuthenticated = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/flor/me", { credentials: "include" });
      if (r.ok) {
        const m = (await r.json()) as {
          florusUserId?: string;
          name: string;
          role?: string;
          subRole?: string | null;
        };
        rememberKioskUser({
          id: m.florusUserId || m.name,
          name: m.name,
          role: roleLabel(m.role, m.subRole),
        });
      }
    } catch {
      /* запомнить не вышло — не критично */
    }
    window.location.assign("/");
  }, []);

  return (
    <div className="eds-admin home">
      <div className={"home-stage" + (fx ? " is-fx" : "")}>
        <div className="home-screen" key={mode}>
          {mode === "landing" && <Landing onLogin={login} banner={banner} />}
          {mode === "bind" && (
            <DeviceBind active onBound={onBound} onExit={exitBind} />
          )}
          {mode === "kiosk" && (
            <KioskLogin onAuthenticated={onAuthenticated} onUnbind={onUnbind} />
          )}
        </div>
        <WaterOverlay show={fx} />
      </div>

      {/* Скрытый фолбэк активации привязки (если комбинация перехвачена системой). */}
      {mode !== "kiosk" && (
        <button
          className="home-secret"
          aria-label="Привязать устройство"
          tabIndex={-1}
          onClick={toggleBind}
        />
      )}
    </div>
  );
}
