// Клиент Device Authorization Flow главной страницы (BFF: /api/oidc/device/*).
// credentials:include — чтобы при успешном входе на киоске сервер поставил cookie-сессию.

export type Purpose = "login" | "kiosk";

export interface AuthorizeResp {
  flowId: string;
  qr: string; // строка, которую кодируем в QR
  userCode: string; // короткий код-фолбэк под QR
  verificationUri?: string;
  interval: number; // секунды между опросами
  expiresIn: number; // сек до истечения
}

export type PollResp =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "authenticated" }
  | { status: "bound"; deviceToken: string };

const BASE = "/api/oidc/device";
const asJson = (r: Response): Promise<unknown> => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export const deviceApi = {
  authorize: (purpose: Purpose): Promise<AuthorizeResp> =>
    fetch(`${BASE}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ purpose }),
    }).then(asJson) as Promise<AuthorizeResp>,

  poll: (flowId: string): Promise<PollResp> =>
    fetch(`${BASE}/poll?flowId=${encodeURIComponent(flowId)}`, { credentials: "include" }).then(
      asJson,
    ) as Promise<PollResp>,

  bind: (code: string): Promise<{ ok: boolean; deviceName: string }> =>
    fetch(`${BASE}/bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    }).then(asJson) as Promise<{ ok: boolean; deviceName: string }>,
};
