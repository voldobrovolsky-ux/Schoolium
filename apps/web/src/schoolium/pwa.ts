/**
 * Установка приложения (AR-191) — `S-81`. Приложение Schoolium это PWA:
 * «скачать» значит установить оболочку на экран «Домой», после чего сессия
 * живёт до удаления приложения (AR-183). Две платформы — два маршрута:
 *
 *   · Android/Chrome: браузер сам решает, когда предложить установку, и
 *     сообщает об этом событием `beforeinstallprompt`. Событие приходит ОДИН
 *     раз и рано — до того, как человек дошёл до настроек. Поэтому оно
 *     перехватывается здесь, на уровне модуля, и хранится до нажатия кнопки;
 *   · iPhone/Safari: программного вызова нет вовсе — только «Поделиться → На
 *     экран „Домой“». Экран показывает инструкцию, а не мёртвую кнопку (§6).
 *
 * Установленное приложение узнаётся по `display-mode: standalone` (и
 * `navigator.standalone` у Safari); тот же признак уходит серверу заголовком
 * `x-schoolium-client`, чтобы карта устройств администратора различала
 * «в браузере» и «в приложении» (AR-187).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export type ClientKind = "browser" | "pwa";
export const clientKind = (): ClientKind => (isStandalone() ? "pwa" : "browser");

export type Platform = "android" | "ios" | "desktop";
export function platform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  // iPadOS 13+ представляется как Mac; отличие — сенсорный экран.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
}

/** Есть ли отложенное системное предложение установки (Android/Chrome). */
export const canPromptInstall = (): boolean => deferred !== null;

/**
 * Показать системный диалог установки; `null` — диалога нет, нужна инструкция.
 *
 * Событие одноразовое: `prompt()` на нём второй раз не сработает, каким бы ни
 * был ответ. Поэтому оно сбрасывается при ЛЮБОМ исходе (и при ошибке диалога),
 * иначе «Установить» появлялось бы снова и молчало. Chrome позже пришлёт
 * новое `beforeinstallprompt`, и модуль перехватит его заново.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const ev = deferred;
  if (!ev) return null;
  deferred = null;
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    return outcome;
  } catch {
    return null;
  } finally {
    listeners.forEach((l) => l());
  }
}

/** Подписка экрана на смену доступности установки. */
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
