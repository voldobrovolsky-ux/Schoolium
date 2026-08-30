// Клиент ВРЕМЕННОГО пилотного auth (/api/pilot/*, AUTH_MODE=pilot-qr).
// Owner — по ключу x-pilot-owner-key; вход — публичный (ставит cookie сессии); состояние кабинета — по cookie.

export interface PilotStaff {
  inviteId: string;
  role: string;
  displayName: string | null;
  phone: string | null;
  status: string;
  userId: string | null;
  loggedIn: boolean;
  assigned: boolean;
  assignments: string[]; // ярлыки «5А · Математика»
  token: string | null; // для повторного QR (только пока не вошёл)
}
export interface PilotInvite { inviteId: string; token: string; role: string; displayName: string | null }
export interface PilotClass { id: string; label: string; parallel: number; letter: string }
export interface PilotSubject { id: string; name: string; color: string }
export interface CabinetState { state: "preparing" | "ready"; message?: string }

export class PilotError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function ownerReq<T>(url: string, key: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", "x-pilot-owner-key": key, ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) throw new PilotError(r.status, (await r.text().catch(() => "")) || r.statusText);
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
}

export const pilotApi = {
  // ─── owner (по ключу) ───
  listStaff: (key: string) => ownerReq<PilotStaff[]>("/api/pilot/owner/staff", key),
  addStaff: (key: string, role: "teacher" | "zavuch", displayName?: string) =>
    ownerReq<PilotInvite>("/api/pilot/owner/staff", key, { method: "POST", body: JSON.stringify({ role, displayName }) }),
  listClasses: (key: string) => ownerReq<PilotClass[]>("/api/pilot/owner/classes", key),
  createClass: (key: string, parallel: number, letter: string) =>
    ownerReq<PilotClass>("/api/pilot/owner/classes", key, { method: "POST", body: JSON.stringify({ parallel, letter }) }),
  listSubjects: (key: string) => ownerReq<PilotSubject[]>("/api/pilot/owner/subjects", key),
  createSubject: (key: string, name: string, color?: string) =>
    ownerReq<PilotSubject>("/api/pilot/owner/subjects", key, { method: "POST", body: JSON.stringify({ name, color }) }),
  assign: (key: string, userId: string, classId: string, subjectId: string) =>
    ownerReq<{ id: string }>("/api/pilot/owner/assign", key, { method: "POST", body: JSON.stringify({ userId, classId, subjectId }) }),
  revokeStaff: (key: string, inviteId: string) =>
    ownerReq<{ ok: boolean }>(`/api/pilot/owner/staff/${inviteId}`, key, { method: "DELETE" }),

  // ─── вход по QR (публичный, ставит cookie) ───
  login: async (token: string, phone: string): Promise<{ ok: boolean; userId: string }> => {
    const r = await fetch("/api/pilot/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, phone }),
    });
    if (!r.ok) throw new PilotError(r.status, (await r.text().catch(() => "")) || r.statusText);
    return (await r.json()) as { ok: boolean; userId: string };
  },

  // ─── состояние кабинета (по cookie сессии) ───
  cabinetState: async (): Promise<CabinetState> => {
    const r = await fetch("/api/pilot/cabinet-state", { credentials: "include" });
    if (!r.ok) throw new PilotError(r.status, r.statusText);
    return (await r.json()) as CabinetState;
  },
};
