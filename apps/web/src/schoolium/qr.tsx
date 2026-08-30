/**
 * Камера и распознавание QR — общий модуль контура.
 *
 * QR читают ТРИ экрана версии, и все три по одному правилу: `S-70` (привязка
 * педагога к предмету), `S-80` (подключение устройства) и `S-05` (вход по коду
 * от модератора). Держать три реализации одного видоискателя значит завести
 * три места, где фокус, остановка потока и обработка отказа разъедутся —
 * поэтому здесь ровно одна.
 *
 * `S-05` живёт ДО сессии, `S-70` и `S-80` — после. Общего у них только
 * камера, поэтому модуль не знает ни про `api`, ни про маршруты: он отдаёт
 * распознанную строку наружу и на этом заканчивается.
 */
import { useEffect, useRef } from "react";
import { Button, useFullscreenFlow } from "./ui";

export const hasCamera = (): boolean =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Камера во весь экран с рамкой наведения (`75-adaptive.md` §6).
 *
 * Распознавание — двумя путями, и второй не роскошь: нативный
 * `BarcodeDetector` отсутствует во ВСЁМ WebKit, а на iOS любой браузер — это
 * WebKit. Без запасного декодера сканер не работал бы ни на одном iPhone, и
 * экран открывал бы камеру, в которой ничего не происходит (находка Д16).
 */
export function QrCamera({
  onCode,
  onDenied,
  hint,
  testId,
  onCancel,
}: {
  onCode: (raw: string) => void;
  onDenied: () => void;
  hint: string;
  testId: string;
  onCancel?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const sink = useRef(onCode);
  sink.current = onCode;

  // Камера во весь экран прячет таб-бар и возвращает его по выходу (§6, §2.2).
  useFullscreenFlow(true);

  useEffect(() => {
    if (!hasCamera()) return;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (!alive) return void s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => alive && onDenied());
    return () => {
      alive = false;
      // Дорожки останавливаются явно: иначе камера остаётся включённой после
      // ухода с экрана, а в смоке живой поток держит браузер открытым.
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let stop = false;
    const decode = decoder();
    const tick = async () => {
      if (stop) return;
      const el = video.current;
      if (el && el.readyState >= 2) {
        const raw = await decode(el);
        if (raw) {
          stop = true;
          sink.current(raw);
          return;
        }
      }
      timer = setTimeout(() => void tick(), 250);
    };
    let timer = setTimeout(() => void tick(), 250);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="sch-viewfinder sch-viewfinder--full" data-testid={testId}>
      <video ref={video} autoPlay playsInline muted />
      <div className="sch-viewfinder-frame" />
      <div className="sch-viewfinder-bar">
        <p>{hint}</p>
        {onCancel ? (
          <Button kind="secondary" onClick={onCancel}>
            Отмена
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Декодер кадра. Нативный `BarcodeDetector`, если он есть (Android/Chrome), и
 * `jsQR` по пикселям кадра, если нет (весь WebKit, то есть каждый iPhone).
 *
 * Выбор делается ОДИН раз при монтировании, а не на каждом кадре: наличие API
 * в течение жизни экрана не меняется, а `canvas` под запасной путь имеет смысл
 * заводить только тогда, когда он реально нужен.
 */
function decoder(): (el: HTMLVideoElement) => Promise<string | null> {
  const Native = (
    window as unknown as {
      BarcodeDetector?: new (o: { formats: string[] }) => {
        detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
      };
    }
  ).BarcodeDetector;

  if (Native) {
    const det = new Native({ formats: ["qr_code"] });
    return async (el) => {
      const codes = await det.detect(el).catch(() => []);
      return codes[0]?.rawValue ?? null;
    };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (el) => {
    if (!ctx) return null;
    const w = el.videoWidth;
    const h = el.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(el, 0, 0, w, h);
    const { default: jsQR } = await import("jsqr");
    const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    return found?.data ?? null;
  };
}

/** Экран «нет доступа к камере» — один текст на все три сценария. */
export function CameraDenied({ testId }: { testId: string }) {
  return (
    <div className="sch-card sch-stack" data-testid={testId}>
      <h2>Нет доступа к камере</h2>
      <p className="sch-muted">
        Разрешите камеру в настройках браузера: значок замка в адресной строке → «Камера» → «Разрешить», затем
        обновите страницу.
      </p>
      <Button kind="secondary" onClick={() => window.location.reload()}>
        Повторить
      </Button>
    </div>
  );
}

/**
 * Разбор содержимого QR — ОДИН на систему (AR-36: контракт живёт в одном
 * месте). Кодов четыре вида, и после перехода на ссылки своего origin они
 * приходят двумя формами: `https://<origin>/<путь>/<значение>` и старой
 * схемой `schoolium:<вид>:<значение>`. Обе разбираются здесь, чтобы ни один
 * экран не занимался строковой арифметикой сам.
 */
export type QrKind = "link" | "bind" | "code" | "join";

export function parseQr(raw: string): { kind: QrKind; value: string } | null {
  const s = raw.trim();

  const scheme = s.match(/^schoolium:(link|bind|code|join):(.+)$/);
  if (scheme) return { kind: scheme[1] as QrKind, value: scheme[2] };

  try {
    const u = new URL(s);
    // Чужой origin не принимается: QR с другого сайта не должен вести внутрь
    // нашей сессии, даже если путь совпал.
    if (u.origin !== window.location.origin) return null;
    const path = u.pathname.replace(/\/+$/, "");
    const m = path.match(/^\/(link|bind|join)\/([^/]+)$/);
    if (m) return { kind: m[1] as QrKind, value: m[2] };
    const code = path.match(/^\/login\/code\/([0-9]{6})$/);
    if (code) return { kind: "code", value: code[1] };
  } catch {
    /* не URL — значит и не наш код */
  }
  return null;
}
