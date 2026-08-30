import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setDevIdentity } from "@/lib/http";

// Роли как их несёт Флёрус (см. ADR-0005). staff EduStore маппит локально → sub-роль.
export type FlorRole = "owner" | "admin" | "teacher" | "staff" | "parent" | "student";
export type SubRole = "zavuch" | "methodist" | "psychologist" | null;
export type CabinetKey =
  | "owner" | "admin" | "teacher" | "parent" | "student"
  | "zavuch" | "methodist" | "psychologist";

export interface CurrentUser {
  name: string;
  florusRole: FlorRole;
  subRole: SubRole;
  orgName: string;
  cabinet?: CabinetKey; // из каталога прав (бэкенд /me, §5.1) — источник истины
  permissions?: string[]; // коды доступных действий из каталога
}

/**
 * Fallback-резолв кабинета по роли (§5.1). Источник истины — КАТАЛОГ на бэкенде
 * (/me возвращает `cabinet`); этот shim используется в DEV (без бэкенда) и если ответ
 * без cabinet. Маппинг повторяет packageKey на сервере (staff → sub-роль, дефолт методист).
 */
export function resolveCabinet(florusRole: FlorRole, subRole: SubRole): CabinetKey {
  if (florusRole === "staff") return subRole ?? "methodist";
  return florusRole;
}

const DEFAULT_USER: CurrentUser = {
  name: "Анна Соколова",
  florusRole: "teacher",
  subRole: null,
  orgName: "Гимназия №5",
};

interface Ctx {
  user: CurrentUser;
  // DEV: переключаем роль локально для предпросмотра (RoleSwitch).
  setUser: (u: CurrentUser) => void;
}
const C = createContext<Ctx | null>(null);
const KEY = "edustore-dev-user";

/**
 * Контекст текущего пользователя кабинета. В ПРОДе пользователь приходит из сессии
 * Флёруса (initialUser — резолвит гейт в main.tsx). В DEV — DEFAULT_USER + RoleSwitch
 * с запоминанием выбора в localStorage. Редирект на вход и показ лендинга — в гейте.
 */
export function CurrentUserProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser?: CurrentUser;
}) {
  const [user, setUser] = useState<CurrentUser>(() => {
    if (initialUser) return initialUser;
    try {
      return { ...DEFAULT_USER, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return DEFAULT_USER;
    }
  });
  // DEV запоминает выбранную роль; в ПРОДе роль из сессии не перетираем.
  useEffect(() => {
    if (import.meta.env.PROD) return;
    localStorage.setItem(KEY, JSON.stringify(user));
  }, [user]);
  // HTTP-слой новых экранов шлёт x-florus-* под текущую роль (DEV) — RBAC как в проде.
  useEffect(() => {
    setDevIdentity({ role: user.florusRole, subRole: user.subRole });
  }, [user.florusRole, user.subRole]);

  return <C.Provider value={{ user, setUser }}>{children}</C.Provider>;
}

export function useCurrentUser(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useCurrentUser must be used within CurrentUserProvider");
  return c;
}
