/**
 * Загрузка данных экрана с тремя состояниями (`70-screens.md` §0): `loading`,
 * `error`, данные. Экран без всех трёх не принимается, поэтому состояние здесь
 * одно и то же для всех экранов, а не выдумывается каждым заново.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SchoolApiError } from "./api";

export type Async<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/** Тихое самообновление — не чаще раза в N мс: «синхронные изменения» — это
 *  возврат к вкладке со свежими данными, а не поллинг сервера. */
const REVALIDATE_MIN_MS = 15_000;

export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): [Async<T>, () => void, (d: T) => void] {
  const [state, setState] = useState<Async<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const fn = useRef(load);
  fn.current = load;
  // Поколение вместо флага `alive`: и cleanup, и смена deps, и тихий рефетч
  // обесценивают ответы предыдущих запросов одним инкрементом.
  const gen = useRef(0);
  const lastAt = useRef(0);
  const busy = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const g = ++gen.current;
    setState({ status: "loading" });
    fn.current()
      .then((data) => {
        if (g !== gen.current) return;
        lastAt.current = Date.now();
        setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (g !== gen.current) return;
        lastAt.current = Date.now();
        setState({
          status: "error",
          // Причина СЛОВАМИ: «произошла ошибка» — дефект (§0).
          message: e instanceof SchoolApiError ? e.message : "Неизвестная ошибка",
        });
      });
    return () => {
      gen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  // Самообновление при возврате в приложение (правка владельца 2026-08-31:
  // «нужны синхронные изменения») — ТИХОЕ, без `status: "loading"`: скелетоны
  // размонтировали бы всё поддерево вместе с открытыми модалками и введённым
  // в них. Пропускается, пока открыт любой слой (.sch-overlay/.sch-popover):
  // часть экранов выводит сущность модалки из state.data, и подмена данных
  // под открытой формой её бы закрыла или переписала.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      if (busy.current) return;
      if (Date.now() - lastAt.current < REVALIDATE_MIN_MS) return;
      if (stateRef.current.status !== "ready") return;
      if (document.querySelector(".sch-overlay, .sch-popover")) return;
      const g = gen.current;
      busy.current = true;
      fn.current()
        .then((data) => {
          if (g !== gen.current) return;
          // Слой мог ОТКРЫТЬСЯ, пока ответ летел: данные под открытой формой
          // не подменяем — гвард на старте это окно не закрывает.
          if (document.querySelector(".sch-overlay, .sch-popover")) return;
          setState({ status: "ready", data });
        })
        // Ошибка тихого рефетча не показывается: на экране остаются
        // прежние данные, у явной загрузки есть свой Retry.
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
          lastAt.current = Date.now();
        });
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const patch = useCallback((data: T) => setState({ status: "ready", data }), []);
  return [state, reload, patch];
}

/** Поллинг раз в 2 секунды, пока карточка открыта (AR-87). WebSocket не вводится. */
export function usePolling(fn: () => void | Promise<void>, ms: number, active: boolean): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

/**
 * Точка останова версии — одна (`75-adaptive.md` §1): `<768px` мобайл, `≥768px`
 * десктоп. Промежуточной (планшетной) раскладки в 1.1.1 нет, поэтому и хук
 * отвечает одним булевым значением, а не «размером экрана».
 *
 * Подписка обязательна: раскладка меняется не только при повороте телефона, но
 * и когда окно десктопа сужают. Замороженное на монтировании значение оставило
 * бы половину контура в чужой раскладке до перезагрузки — и починить это можно
 * было бы только F5, чего человеку никто не подскажет.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    let t: number | undefined;
    const on = () => {
      // Раскладка меняется по УСТОЯВШЕМУСЯ значению. Мгновенный флип
      // туда-обратно (исчезновение скроллбара, полностраничный скриншот,
      // системная шторка) без задержки пересобирал бы оболочку и молча
      // терял открытые модалки вместе с введённым в них.
      window.clearTimeout(t);
      t = window.setTimeout(() => setMobile(mq.matches), 120);
    };
    mq.addEventListener("change", on);
    setMobile(mq.matches);
    return () => {
      window.clearTimeout(t);
      mq.removeEventListener("change", on);
    };
  }, []);
  return mobile;
}
