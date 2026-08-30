// Общий HTTP-слой новых экранов. ПРОД (pilot-qr/Флёр): доступ по cookie-сессии, заголовки роли
// игнорируются бэком (bypass выключен). DEV: подставляем x-florus-* под текущую роль RoleSwitch,
// чтобы RBAC-гейты (§5.1) работали как в проде (завуч approve, учитель conduct).

export interface DevIdentity {
  role: string;
  subRole: string | null;
}

let devIdentity: DevIdentity = { role: "teacher", subRole: null };

/** Обновляется CurrentUserProvider при смене роли (DEV). В ПРОДе не влияет. */
export function setDevIdentity(id: DevIdentity): void {
  devIdentity = id;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

function devHeaders(): Record<string, string> {
  if (import.meta.env.PROD) return {};
  return {
    "x-florus-user-id": "teacher-anna",
    "x-florus-role": devIdentity.role,
    ...(devIdentity.subRole ? { "x-florus-subrole": devIdentity.subRole } : {}),
  };
}

export async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", ...devHeaders(), ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      message = body.message ?? message;
      code = body.code;
    } catch {
      /* тело не JSON */
    }
    throw new HttpError(res.status, message, code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
