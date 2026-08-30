// localStorage привязанного устройства-киоска: device-токен (признак режима 3)
// + список последних учителей (карточки, максимум 8). Всё — best-effort (try/catch),
// чтобы приватный режим/выключенный storage не ломали главную.

const TOKEN_KEY = "edustore-device-token";
const USERS_KEY = "edustore-kiosk-users";
const MAX_USERS = 8;

export const getDeviceToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setDeviceToken = (t: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* ignore */
  }
};
export const clearDeviceToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

export interface KioskUser {
  id: string;
  name: string;
  role: string; // человекочитаемая роль (для подписи карточки)
  at: number; // когда заходил
}

export const getKioskUsers = (): KioskUser[] => {
  try {
    const a = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    return Array.isArray(a) ? (a as KioskUser[]) : [];
  } catch {
    return [];
  }
};

/** Запомнить вошедшего: поднимаем наверх, дедуп по id, не больше MAX_USERS. */
export const rememberKioskUser = (u: Omit<KioskUser, "at">): void => {
  const list = getKioskUsers().filter((x) => x.id !== u.id);
  list.unshift({ ...u, at: Date.now() });
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(list.slice(0, MAX_USERS)));
  } catch {
    /* ignore */
  }
};

export const forgetKioskUser = (id: string): void => {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(getKioskUsers().filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
};
