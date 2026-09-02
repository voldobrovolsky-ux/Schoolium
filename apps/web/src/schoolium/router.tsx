/**
 * Маршрутизация Schoolium по ПУТИ (AR-41: раздел отражается в URL), без
 * тяжёлого роутера. Карта маршрутов — из `30-spec.md` «Карта сайта» (AR-95):
 * аноним на маршруте приложения уходит на `/login?next=<путь>`, вошедший на
 * `/login` — на стартовый экран роли.
 */
import { useCallback, useEffect, useState } from "react";

export interface Route {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

/** Маршруты приложения — те, что требуют сессии. */
/*
 * `/link` и `/bind` — маршруты QR-кодов, и они ТРЕБУЮТ сессии: код привязки
 * устройства сканирует уже вошедший телефон, код привязки к предмету —
 * педагог со своей сессией. Аноним, открывший такую ссылку, уходит на
 * `/login?next=…` и возвращается сюда после входа — а не упирается в белый
 * экран с непонятной ошибкой.
 */
export const APP_PREFIXES = [
  "/classes",
  "/subjects",
  "/staff",
  "/guardians",
  "/schedule",
  "/journal",
  "/diary",
  // три кабинета (AR-186): администратор, модератор, завуч
  "/admin",
  "/moderator",
  "/deputy",
  "/scan",
  "/settings",
  "/link",
  "/bind",
];

/** Разделы кабинета администратора (`S-62`, AR-186) — отражаются в URL (AR-41). */
export const ADMIN_SECTIONS = ["overview", "devices", "roles", "network", "audit", "policy"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** Публичные маршруты контура входа — показываются БЕЗ оболочки (§2.3). */
export const PUBLIC_PATHS = ["/", "/schools", "/login", "/login/code", "/join", "/bootstrap"];

export function parse(pathname: string, search: string): Route {
  const query = new URLSearchParams(search);
  const params: Record<string, string> = {};
  let path = pathname.replace(/\/+$/, "") || "/";

  const join = path.match(/^\/join\/([^/]+)(\/photo)?$/);
  if (join) {
    params.token = join[1];
    path = join[2] ? "/join/:token/photo" : "/join/:token";
  }
  /*
   * Маршруты QR-кодов. Код — это ССЫЛКА своего origin, а не схема
   * `schoolium:` (В1): штатная камера iPhone распознаёт QR сама и открывает
   * ссылку, а схему без зарегистрированного обработчика открыть нечем. Это
   * единственный путь входа по QR на iOS: `BarcodeDetector` отсутствует во
   * всём WebKit, и наш сканер там работает только запасным декодером.
   */
  const linkTok = path.match(/^\/link\/([^/]+)$/);
  if (linkTok) {
    params.token = linkTok[1];
    path = "/link/:token";
  }
  const bindTok = path.match(/^\/bind\/([^/]+)$/);
  if (bindTok) {
    params.token = bindTok[1];
    path = "/bind/:token";
  }
  // Личный QR педагога (AR-179): камера телефона открывает ссылку сама.
  const comp = path.match(/^\/competence\/([^/]+)$/);
  if (comp) {
    params.teacherId = comp[1];
    path = "/competence/:teacherId";
  }
  const loginCode = path.match(/^\/login\/code\/([0-9]{6})$/);
  if (loginCode) {
    params.code = loginCode[1];
    path = "/login/code/:code";
  }
  const boot = path.match(/^\/bootstrap\/([^/]+)$/);
  if (boot) {
    params.token = boot[1];
    path = "/bootstrap/:token";
  }
  const cls = path.match(/^\/classes\/([^/]+)(?:\/student\/([^/]+))?$/);
  if (cls) {
    params.classId = cls[1];
    if (cls[2]) params.studentId = cls[2];
    path = cls[2] ? "/classes/:classId/student/:studentId" : "/classes/:classId";
  }
  const subj = path.match(/^\/subjects\/([^/]+)$/);
  if (subj) {
    params.subjectId = subj[1];
    path = "/subjects/:subjectId";
  }
  const staff = path.match(/^\/staff\/([^/]+)$/);
  if (staff) {
    params.personId = staff[1];
    path = "/staff/:personId";
  }
  const guardian = path.match(/^\/guardians\/([^/]+)$/);
  if (guardian) {
    params.guardianId = guardian[1];
    path = "/guardians/:guardianId";
  }
  // Кабинет администратора: `/admin/<раздел>`; неизвестный раздел — обзор.
  const admin = path.match(/^\/admin\/([^/]+)$/);
  if (admin) {
    params.section = (ADMIN_SECTIONS as readonly string[]).includes(admin[1]) ? admin[1] : "overview";
    path = "/admin/:section";
  }
  return { path, params, query };
}

/** Переход без перезагрузки: URL отражает раздел, «назад» браузера работает. */
export function navigate(to: string): void {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const read = useCallback(() => parse(window.location.pathname, window.location.search), []);
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onPop = () => setRoute(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [read]);
  return route;
}

export const isAppPath = (path: string): boolean => APP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
