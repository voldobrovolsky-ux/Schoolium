/**
 * Сессия и права на клиенте. Права приходят с сервера (`GET /api/v1/me`) —
 * фронт их не вычисляет: каталог прав живёт в БД, и клиентская копия правил
 * разошлась бы с сервером в первый же день (AR-7, AR-35).
 *
 * Клиентская проверка права — это НЕ гейт, а правило рендера: гейт стоит в
 * контракте (красная линия 3). Кнопка, недоступная роли, не рендерится (AR-69);
 * попытка обойти интерфейс всё равно упирается в сервер.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { MeDto, SchoolPermission } from "@edustore/shared";
import { api, SchoolApiError } from "./api";

type State =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "authed"; me: MeDto };

interface Ctx {
  state: State;
  reload: () => Promise<void>;
  can: (p: SchoolPermission) => boolean;
  logout: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const reload = useCallback(async () => {
    try {
      const me = await api.me();
      setState({ status: "authed", me });
    } catch (e) {
      // `ACCESS_REVOKED` и отсутствие сессии внешне неразличимы: и то, и другое
      // означает «этот браузер школы не знает» — маршрут один, экран входа.
      if (e instanceof SchoolApiError) setState({ status: "anon" });
      else setState({ status: "anon" });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = useCallback(
    (p: SchoolPermission) => state.status === "authed" && state.me.permissions.includes(p),
    [state],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setState({ status: "anon" });
    window.location.assign("/");
  }, []);

  return <SessionCtx.Provider value={{ state, reload, can, logout }}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("SessionProvider отсутствует");
  return ctx;
}

/** Текущий пользователь там, где экран уже знает, что сессия есть. */
export function useMe(): MeDto {
  const { state } = useSession();
  if (state.status !== "authed") throw new Error("экран требует сессии");
  return state.me;
}
