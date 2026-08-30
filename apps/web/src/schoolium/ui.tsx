/**
 * Библиотека Schoolium: девять типов кнопок (§4), модалка с ловушкой фокуса
 * (§3, AR-82), три состояния экрана (§5) и мелкие элементы.
 *
 * Раскладок ДВЕ, и обе живут здесь, а не в экранах (`75-adaptive.md` §1):
 * геометрия слоя выбирается по точке останова, гарантии §3 — фокус, `Esc`,
 * закрытие фоном, два уровня вложенности — у обеих одни и те же. Иначе мобайл
 * получил бы вторую реализацию тех же правил и вторую же возможность их
 * потерять: ровно так этап 2 потерял фокус в поповере.
 *
 * Правила, которые здесь ЗАШИТЫ, а не оставлены на дисциплину экрана:
 *   · модалка и поповер закрываются крестиком, `Esc` и кликом мимо, держат фокус
 *     внутри и возвращают его открывателю;
 *   · уровней вложенности слоя ровно два — третий не выразим типом (AR-82);
 *   · ни одного литерального цвета: всё через классы на CSS-переменных.
 *
 * Правило «кнопка, недоступная роли, НЕ рендерится» (AR-69) живёт НЕ здесь:
 * библиотека не знает прав, их знает экран. Экран получает право из `session`
 * и не передаёт кнопку в `action`/разметку — `disabled` означает «нельзя
 * сейчас», отсутствие означает «не ваша роль». Держится это перечислением
 * гейтов `can(...)` в экранах и живой проверкой смока G-53 на сессии педагога.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { MARK_VALUES, type MarkValue } from "@edustore/shared";
import { useIsMobile } from "./hooks";

// ─────────────────────────── кнопки (реестр §4) ───────────────────────────

export type ButtonKind =
  | "primary"
  | "accent"
  | "secondary"
  | "ghost"
  | "danger"
  | "off"
  | "icon"
  | "fab"
  | "chip";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind;
  loading?: boolean;
  testId?: string;
}

export function Button({ kind = "primary", loading, testId, children, className, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={className ? `sch-btn sch-btn--${kind} ${className}` : `sch-btn sch-btn--${kind}`}
      data-testid={testId}
      data-kind={kind}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {/* loading: спиннер ВМЕСТО текста, ширина кнопки не меняется (§5) */}
      {loading ? <span className="sch-spinner" aria-label="загрузка" /> : children}
    </button>
  );
}

// ─────────────────────────── поля ───────────────────────────

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  testId?: string;
  hint?: string;
}

export function Field({ label, error, testId, hint, ...rest }: FieldProps) {
  const id = useId();
  return (
    <div className="sch-field">
      <label className="sch-field-label" htmlFor={id}>
        {label}
        {hint ? <span className="sch-muted"> · {hint}</span> : null}
      </label>
      <input
        id={id}
        className="sch-input"
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        {...rest}
      />
      {/* Ошибка поля — рамка И текст причины: цвет один смысла не кодирует (AR-80). */}
      {error ? (
        <span className="sch-field-error" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Числовое поле с шаговыми кнопками «−»/«+» 44×44 рядом (§7). На десктопе
 * кнопки не рендерятся визуально (CSS `min-width: 768px`): там поле правится
 * с клавиатуры, и лишняя пара мишеней — шум. На телефоне обратное: попасть в
 * узкое поле и вызвать цифровую клавиатуру ради «+1» дороже, чем нажать шаг.
 *
 * Значение остаётся СТРОКОЙ: пустое поле — это не ноль, и мастер обязан
 * отличать «не ввели» от «ввели 0» (шаг 5 `S-11` принимает ноль как ответ).
 */
export function NumberField({
  label,
  testId,
  value,
  onValue,
  min,
  max,
  hint,
  error,
}: {
  label: string;
  testId?: string;
  value: string;
  onValue: (v: string) => void;
  min: number;
  max: number;
  hint?: string;
  error?: string | null;
}) {
  const id = useId();
  const step = (d: number) => {
    const base = value === "" ? min : Number(value);
    const next = Math.min(max, Math.max(min, (Number.isFinite(base) ? base : min) + d));
    onValue(String(next));
  };
  return (
    <div className="sch-field">
      <label className="sch-field-label" htmlFor={id}>
        {label}
        {hint ? <span className="sch-muted"> · {hint}</span> : null}
      </label>
      <div className="sch-stepper">
        <Button
          kind="secondary"
          className="sch-btn--stepper"
          aria-label={`${label}: меньше`}
          testId={testId ? `${testId}.minus` : undefined}
          disabled={value !== "" && Number(value) <= min}
          onClick={() => step(-1)}
        >
          −
        </Button>
        <input
          id={id}
          className="sch-input"
          data-testid={testId}
          inputMode="numeric"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onValue(e.target.value)}
        />
        <Button
          kind="secondary"
          className="sch-btn--stepper"
          aria-label={`${label}: больше`}
          testId={testId ? `${testId}.plus` : undefined}
          disabled={value !== "" && Number(value) >= max}
          onClick={() => step(1)}
        >
          +
        </Button>
      </div>
      {error ? (
        <span className="sch-field-error" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ─────────────────────────── модалка (§3) ───────────────────────────

/**
 * Мобильная форма слоя (`75-adaptive.md` §3, колонка Mobile). Значение НЕ
 * угадывается компонентом: у каждой из пятнадцати модалок реестра она уже
 * названа, и экран обязан её передать — «по умолчанию полноэкранная» молча
 * превратило бы подтверждение удаления в поток на весь экран.
 */
export type MobileShape = "fullscreen" | "sheet";

export interface ModalProps {
  title: string;
  width: number;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
  /** Уровень вложенности: максимум два (AR-82). Третий — дефект конструкции. */
  level?: 1 | 2;
  /** Как эта модалка выглядит на мобайле — из колонки Mobile реестра §3. */
  mobile: MobileShape;
  /**
   * «Назад» вместо крестика в хедере мобильного потока (§3, полноэкранная
   * модалка мастера). На десктопе шаг листается кнопками футера, поэтому
   * значение здесь имеет смысл только в паре с `mobile="fullscreen"`.
   */
  onBack?: () => void;
}

/**
 * Полноэкранный поток на мобайле прячет таб-бар (§2.2) и возвращает его по
 * завершении. Считаем ГЛУБИНОЙ, а не флагом: `M-01` может открыть `M-14`
 * вторым уровнем, и закрытие верхнего слоя не должно возвращать таб-бар под
 * ещё открытый мастер. Признак — атрибут на `body`, потому что таб-бар живёт
 * в оболочке, а слой — в портале своего экрана: общего React-предка у них нет.
 */
let flowDepth = 0;
const enterFlow = () => {
  flowDepth += 1;
  document.body.setAttribute("data-sch-flow", "1");
};
const leaveFlow = () => {
  flowDepth = Math.max(0, flowDepth - 1);
  if (flowDepth === 0) document.body.removeAttribute("data-sch-flow");
};

/**
 * Тот же признак для полноэкранного потока, который НЕ является модалкой:
 * сканер `S-70` — экран, а не слой, но таб-бар при камере во весь экран
 * прячется по тому же правилу §2.2. Считать глубину в двух местах нельзя —
 * счётчик один.
 */
export function useFullscreenFlow(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    enterFlow();
    return leaveFlow;
  }, [active]);
}

export function Modal({ title, width, onClose, children, footer, testId, level = 1, mobile, onBack }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const isMobile = useIsMobile();
  const shape = isMobile ? mobile : "desktop";

  useEffect(() => {
    opener.current = document.activeElement;
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = "hidden"; // контент под блюром не скроллится
    // фокус на первый интерактивный элемент
    const first = ref.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.(); // возврат фокуса открывателю
    };
  }, []);

  // Таб-бар уходит только под полноэкранный поток: нижний лист его не прячет —
  // человек видит, откуда пришёл, и куда вернётся (§3).
  useEffect(() => {
    if (shape !== "fullscreen") return;
    enterFlow();
    return leaveFlow;
  }, [shape]);

  /**
   * Фокус не уходит из модалки, даже когда исчезает элемент, на котором он был.
   * Мастер меняет шаг — кнопка «Далее» размонтируется вместе с содержимым, и
   * фокус падает на `body`. `Esc` и `Tab`-ловушка висят на карточке и ждут
   * события ИЗНУТРИ — а изнутри больше ничего не приходит. Дефект найден смоком
   * G-53: со второго шага мастера расписания `Esc` переставал закрывать `M-08`.
   *
   * Проверка идёт ПОСЛЕ КАЖДОГО рендера, а не по событию: браузер не обещает
   * `focusout`, когда сфокусированный узел удалён, — на это событие полагаться
   * нельзя. Два условия, при которых модалка фокус НЕ отнимает: окно потеряло
   * фокус целиком (человек ушёл в адресную строку) и открыт вложенный слой
   * (AR-82) — забирает верхняя из открытых модалок.
   */
  useEffect(() => {
    const card = ref.current;
    if (!card || !document.hasFocus()) return;
    const active = document.activeElement;
    if (active && card.contains(active)) return;
    // Верхним слоем бывает не только модалка: `M-07` на десктопе — поповер у
    // кнопки (§3), и он живёт вне стопки `.sch-overlay`. Без этой уступки
    // модалка-родитель отбирала бы у него фокус тем же проходом, каким чинила
    // свой, и `Esc` с ловушкой фокуса переставали бы работать — ровно тот
    // дефект, который этап 2 уже ловил в поповере журнала.
    if (document.querySelector('.sch-popover')) return;
    const overlays = document.querySelectorAll('.sch-overlay');
    if (overlays[overlays.length - 1] !== card.parentElement) return;
    card.focus();
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // ловушка фокуса: Tab не выводит за пределы карточки
      const nodes = ref.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    },
    [onClose],
  );

  const swipe = useSwipeDown(shape === "sheet" ? onClose : null);

  return (
    <div
      className="sch-overlay"
      data-level={level}
      data-shape={shape}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(); // клик по фону
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="sch-modal"
        data-shape={shape}
        /* Ширина из реестра — ДЕСКТОПНАЯ величина. На мобайле лист и поток
           занимают всю ширину вьюпорта, и инлайновое значение победило бы CSS. */
        style={shape === "desktop" ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        ref={ref}
        tabIndex={-1}
        {...swipe}
      >
        {shape === "sheet" ? <div className="sch-sheet-handle" aria-hidden="true" /> : null}
        <div className="sch-modal-head">
          {/* У мастера на мобайле в хедере «Назад», а не крестик (§3). */}
          {shape === "fullscreen" && onBack ? (
            <Button kind="icon" onClick={onBack} aria-label="Назад" testId={testId ? `${testId}.back.header` : undefined}>
              ‹
            </Button>
          ) : null}
          <h2 id={titleId}>{title}</h2>
          <Button kind="icon" onClick={onClose} aria-label="Закрыть" testId={testId ? `${testId}.close` : undefined}>
            ✕
          </Button>
        </div>
        <div className="sch-modal-body">{children}</div>
        {footer ? <div className="sch-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * Свайп вниз закрывает нижний лист (§3) — единственный жест версии: §8 прямо
 * запрещает остальные. Порог в 64px и требование «тянуть вниз, а не вбок»
 * нужны, чтобы прокрутка содержимого листа не читалась как закрытие.
 */
function useSwipeDown(onClose: (() => void) | null) {
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!onClose) return {};
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s0 = start.current;
      start.current = null;
      if (!s0) return;
      const t = e.changedTouches[0];
      const dy = t.clientY - s0.y;
      const dx = Math.abs(t.clientX - s0.x);
      if (dy > 64 && dy > dx) onClose();
    },
  };
}

/**
 * Поповер — второй способ показать слой (`S-51`, `S-52`): якорится к клетке
 * таблицы, но подчиняется тем же правилам §0, что и модалка — ловушка фокуса,
 * `Esc` закрывает, фокус возвращается открывателю. Разница лишь в геометрии:
 * поповер не затемняет экран и не блокирует прокрутку, потому что журнал под
 * ним остаётся контекстом действия.
 */
export function Popover({
  anchor,
  onClose,
  children,
  testId,
  label,
  width,
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  label: string;
  /** Ширина из реестра §3: поповеры версии — 240, 280 и 320px. */
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const el = ref.current;
    if (el) {
      const box = el.getBoundingClientRect();
      // Поповер не выходит за окно: если снизу/справа не хватает места —
      // разворачивается вверх/влево от якоря.
      const below = anchor.bottom + 8;
      const top = below + box.height > window.innerHeight ? Math.max(8, anchor.top - box.height - 8) : below;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
      setPos({ top, left });
    }
    return () => {
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [anchor]);

  /**
   * Фокус ставится ОТДЕЛЬНЫМ проходом — после того, как позиция посчитана и
   * слой перестал быть `visibility: hidden`. Скрытый элемент сфокусировать
   * нельзя: браузер молча отказывает, и вместе с фокусом пропадают обе гарантии
   * §0 — `Esc` закрывает (обработчик висит на слое и ждёт события изнутри) и
   * `Tab` не уводит наружу. Дефект найден смоком G-53: после сохранения темы
   * `Esc` не закрывал `S-51`.
   */
  useEffect(() => {
    if (!pos) return;
    ref.current?.querySelector<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')?.focus();
  }, [pos]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [onClose]);

  return (
    <div
      className="sch-popover"
      role="dialog"
      aria-label={label}
      data-testid={testId}
      ref={ref}
      style={
        pos
          ? { top: pos.top, left: pos.left, width }
          : { top: anchor.bottom + 8, left: anchor.left, width, visibility: "hidden" }
      }
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          return;
        }
        if (e.key !== "Tab") return;
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!nodes || nodes.length === 0) return;
        const list = Array.from(nodes);
        const firstEl = list[0];
        const lastEl = list[list.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * Слой, у которого две формы по реестру §3: **поповер у якоря** на десктопе и
 * **нижний лист** на мобайле. Таких в версии четыре — `M-07`, `M-11` (`S-51`),
 * `M-12` (`S-52`) и `M-15`.
 *
 * Экран не выбирает форму сам и не пишет её дважды: он говорит, к чему слой
 * якорится и как называется, а раскладку выбирает библиотека. Иначе четыре
 * экрана завели бы четыре реализации одного правила — и три из них рано или
 * поздно разошлись бы с четвёртой.
 */
export function PopoverOrSheet({
  anchor,
  onClose,
  children,
  testId,
  label,
  width,
  level = 1,
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  label: string;
  /** Десктопная ширина поповера из реестра §3. */
  width: number;
  level?: 1 | 2;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Modal title={label} width={width} onClose={onClose} testId={testId} level={level} mobile="sheet">
        {children}
      </Modal>
    );
  }
  return (
    <Popover anchor={anchor} onClose={onClose} testId={testId} label={label} width={width}>
      {children}
    </Popover>
  );
}

// ─────────────────────────── состояния экрана (§5) ───────────────────────────

export function Skeletons({ count, kind = "card" }: { count: number; kind?: "card" | "row" | "qr" }) {
  return (
    <div className={kind === "card" ? "sch-cards--4" : "sch-stack"} data-testid="state.loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`sch-skeleton sch-skeleton--${kind}`} />
      ))}
    </div>
  );
}

/**
 * Пустое состояние: иллюстрация + заголовок + ОДНА primary-кнопка, ведущая к
 * следующему шагу онбординга. У роли без права кнопка НЕ рендерится, и текст
 * другой: «появятся, когда модератор их создаст» (AR-69, красная линия 7).
 */
export function EmptyState({
  title,
  hint,
  action,
  testId,
  glyph = "◇",
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  testId?: string;
  glyph?: string;
}) {
  return (
    <div className="sch-state" data-testid={testId}>
      <div className="sch-state-illustration" aria-hidden="true">
        {glyph}
      </div>
      <h2>{title}</h2>
      {hint ? <p className="sch-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

/** Ошибка экрана: причина СЛОВАМИ и кнопка «Повторить». «Произошла ошибка» — дефект. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sch-error-card" role="alert" data-testid="state.error">
      <strong>Не получилось загрузить</strong>
      <span>{message}</span>
      <Button kind="secondary" onClick={onRetry} testId="state.error.retry">
        Повторить
      </Button>
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <div className="sch-toast" role="status" data-testid="toast">
      {text}
    </div>
  );
}

/** Тост живёт 4 секунды, одновременно — максимум один (§5). */
export function useToast() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 4000);
    return () => clearTimeout(t);
  }, [text]);
  return { toast: text, showToast: setText };
}

// ─────────────────────────── мелкие элементы ───────────────────────────

export function Avatar({ name, url, large }: { name: string | null; url?: string | null; large?: boolean }) {
  const cls = large ? "sch-avatar sch-avatar--lg" : "sch-avatar";
  if (url) return <img className={cls} src={url} alt={name ?? ""} />;
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={cls} aria-hidden={name ? undefined : true}>
      {initials || "·"}
    </span>
  );
}

export function Badge({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <span className={muted ? "sch-badge sch-badge--muted" : "sch-badge"}>{children}</span>;
}

/**
 * Чип отметки: символ на подложке. Смысл несёт СИМВОЛ, цвет только помогает —
 * человек с дальтонизмом различает все шесть значений (AR-80, красная линия 4).
 */
export function MarkChip({ value }: { value: MarkValue }) {
  const key = value === "н" ? "n" : value === "б" ? "b" : `m${value}`;
  return <span className={`sch-mark sch-mark--${key}`}>{value}</span>;
}

export const MARK_ORDER = MARK_VALUES;

/** Ключ чипа отметки для `data-testid`: `S-52.chip.m5` … `S-52.chip.b`. */
export const markKey = (m: MarkValue): string => (m === "н" ? "n" : m === "б" ? "b" : `m${m}`);
