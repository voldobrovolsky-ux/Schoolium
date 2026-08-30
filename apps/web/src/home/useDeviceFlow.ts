import { useEffect, useRef, useState } from "react";
import { deviceApi, type Purpose } from "./deviceApi";

export type FlowStatus = "starting" | "waiting" | "error";
export interface FlowState {
  status: FlowStatus;
  qr?: string;
  userCode?: string;
}

/**
 * Device Authorization Flow: при enabled запрашивает QR и опрашивает статус.
 * Сам перезапускается по истечении кода. Вызывает onAuthenticated (вход на киоске)
 * или onBound (привязка устройства) при завершении.
 */
export function useDeviceFlow(opts: {
  purpose: Purpose;
  enabled: boolean;
  onAuthenticated?: () => void;
  onBound?: (deviceToken: string) => void;
}): FlowState {
  const { purpose, enabled } = opts;
  const [state, setState] = useState<FlowState>({ status: "starting" });
  // колбэки держим в ref, чтобы не перезапускать эффект при их пересоздании
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: number | undefined;

    const start = async (): Promise<void> => {
      setState({ status: "starting" });
      try {
        const a = await deviceApi.authorize(purpose);
        if (!alive) return;
        setState({ status: "waiting", qr: a.qr, userCode: a.userCode });
        const everyMs = Math.max(2, a.interval) * 1000;
        const deadline = Date.now() + a.expiresIn * 1000;

        const tick = async (): Promise<void> => {
          if (!alive) return;
          try {
            const r = await deviceApi.poll(a.flowId);
            if (!alive) return;
            if (r.status === "authenticated") return void cb.current.onAuthenticated?.();
            if (r.status === "bound") return void cb.current.onBound?.(r.deviceToken);
            if (r.status === "expired" || Date.now() > deadline) return void start();
          } catch {
            /* временная сетевая ошибка — продолжаем опрос */
          }
          timer = window.setTimeout(tick, everyMs);
        };
        timer = window.setTimeout(tick, everyMs);
      } catch {
        if (!alive) return;
        setState({ status: "error" });
        timer = window.setTimeout(start, 5000); // повтор авторизации (напр. discovery недоступен)
      }
    };

    void start();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [purpose, enabled]);

  return state;
}
