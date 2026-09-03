/**
 * Библиотека Schoolium: девять типов кнопок (§4), слои на Radix Primitives
 * (AR-197), три состояния экрана (§5) и мелкие элементы.
 *
 * Слои — модалка, поповер, тост — с 1.4.0 держатся на `@radix-ui/react-dialog`,
 * `react-popover` и `react-toast`: `role="dialog"`, `aria-modal`, ловушка и
 * возврат фокуса (в том числе когда сфокусированный узел исчез — мастер сменил
 * шаг), `Esc`, закрытие по клику мимо, блокировка прокрутки и позиционирование
 * с уходом от края берутся из библиотеки, а не пишутся здесь по третьему разу.
 * Radix входит в контур ТОЛЬКО через этот файл и `shell.tsx` — держится
 * воротами G-84 (`tools/design/check-layers.mjs`). Порталы Radix рендерятся в
 * `body`, вне корня `.sch`, поэтому каждый слой несёт класс `sch-portal` —
 * ту же базовую типографику без фона.
 *
 * Раскладок ДВЕ, и обе живут здесь, а не в экранах (`75-adaptive.md` §1):
 * геометрия слоя выбирается по точке останова (`data-shape`), гарантии §3 у
 * обеих одни и те же — библиотека одна.
 *
 * Правило «кнопка, недоступная роли, НЕ рендерится» (AR-69) живёт НЕ здесь:
 * библиотека не знает прав, их знает экран. `disabled` означает «нельзя
 * сейчас», отсутствие означает «не ваша роль».
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as ToastPrimitive from "@radix-ui/react-toast";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { MARK_VALUES, type MarkValue } from "@edustore/shared";
import { useIsMobile } from "./hooks";
import { Icon, type IconName } from "./icons";

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
 * Числовое поле с шаговыми кнопками «−»/«+» рядом (§7). На десктопе кнопки не
 * рендерятся визуально (CSS `min-width: 768px`): там поле правится с
 * клавиатуры, и лишняя пара мишеней — шум. На телефоне обратное: попасть в
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
          <Icon name="minus" />
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
          <Icon name="plus" />
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

// ─────────────────────────── модалка (§3, AR-82, AR-197) ───────────────────────────

/**
 * Мобильная форма слоя (`75-adaptive.md` §3, колонка Mobile). Значение НЕ
 * угадывается компонентом: у каждой модалки реестра она уже названа, и экран
 * обязан её передать — «по умолчанию полноэкранная» молча превратило бы
 * подтверждение удаления в поток на весь экран.
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
 * в оболочке, а слой — в портале: общего React-предка у них нет.
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
 * прячется по тому же правилу §2.2. Счётчик один.
 */
export function useFullscreenFlow(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    enterFlow();
    return leaveFlow;
  }, [active]);
}

/**
 * Модалка на `Dialog` Radix. Библиотека даёт `role="dialog"`, `aria-modal`,
 * `aria-labelledby`, ловушку фокуса (`FocusScope` следит и за удалением
 * сфокусированного узла — дефект G-53 «`Esc` со второго шага мастера» закрыт
 * по построению), возврат фокуса открывателю, `Esc`, закрытие по клику мимо и
 * блокировку прокрутки под слоем. Наши — форма (`data-shape`), уровень,
 * шапка, футер, ручка и свайп листа.
 *
 * `Content` вложен в `Overlay`, а не стоит рядом: центрирование и раскладка
 * листа/потока живут в CSS на `.sch-overlay[data-shape]`, и смок читает уровни
 * вложенности числом `.sch-overlay` (AR-82).
 */
export function Modal({ title, width, onClose, children, footer, testId, level = 1, mobile, onBack }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const shape = isMobile ? mobile : "desktop";

  // Таб-бар уходит только под полноэкранный поток: нижний лист его не прячет —
  // человек видит, откуда пришёл, и куда вернётся (§3).
  useEffect(() => {
    if (shape !== "fullscreen") return;
    enterFlow();
    return leaveFlow;
  }, [shape]);

  const swipe = useSwipeDown(shape === "sheet" ? onClose : null);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sch-portal sch-overlay" data-level={level} data-shape={shape}>
          <Dialog.Content
            ref={ref}
            className="sch-modal"
            data-shape={shape}
            data-testid={testId}
            /* Ширина из реестра — ДЕСКТОПНАЯ величина. На мобайле лист и поток
               занимают всю ширину вьюпорта, и инлайновое значение победило бы CSS. */
            style={shape === "desktop" ? { width } : undefined}
            /* Описания у модалок реестра нет — заголовка достаточно; явный
               `undefined` снимает предупреждение Radix о недостающем Description. */
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              // Поле с autoFocus берёт фокус первым, а не кнопка «Закрыть» из шапки.
              const first = ref.current?.querySelector<HTMLElement>("[autofocus]");
              if (first) {
                e.preventDefault();
                first.focus();
              }
            }}
            {...swipe}
          >
            {shape === "sheet" ? <div className="sch-sheet-handle" aria-hidden="true" /> : null}
            <div className="sch-modal-head">
              {/* У мастера на мобайле в хедере «Назад», а не крестик (§3). */}
              {shape === "fullscreen" && onBack ? (
                <Button kind="icon" onClick={onBack} aria-label="Назад" testId={testId ? `${testId}.back.header` : undefined}>
                  <Icon name="chevronLeft" />
                </Button>
              ) : null}
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button kind="icon" aria-label="Закрыть" testId={testId ? `${testId}.close` : undefined}>
                  <Icon name="close" />
                </Button>
              </Dialog.Close>
            </div>
            <div className="sch-modal-body">{children}</div>
            {footer ? <div className="sch-modal-foot">{footer}</div> : null}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
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
 * Поповер — второй способ показать слой (`S-51`, `S-52`, `M-07`, `M-15`):
 * якорится к клетке таблицы или кнопке и подчиняется тем же правилам §0, что
 * и модалка — ловушка фокуса, `Esc`, возврат фокуса открывателю. Разница в
 * геометрии: без затемнения, у якоря, с уходом от края окна.
 *
 * Якорь остаётся `DOMRect`: экраны передают прямоугольник клетки, а не
 * элемент, и `Popover.Anchor virtualRef` принимает ровно это. `modal` — потому
 * что реестр §3 требует ловушку фокуса, а немодальный поповер Radix её не
 * держит (Tab уходит наружу и закрывает слой).
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
  const virtualRef = useRef({ getBoundingClientRect: () => anchor });
  virtualRef.current = { getBoundingClientRect: () => anchor };
  return (
    <PopoverPrimitive.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverPrimitive.Anchor virtualRef={virtualRef} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="sch-portal sch-popover"
          data-testid={testId}
          aria-label={label}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          style={{ width }}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * Слой, у которого две формы по реестру §3: **поповер у якоря** на десктопе и
 * **нижний лист** на мобайле. Таких в версии четыре — `M-07`, `M-11` (`S-51`),
 * `M-12` (`S-52`) и `M-15`.
 *
 * Экран не выбирает форму сам и не пишет её дважды: он говорит, к чему слой
 * якорится и как называется, а раскладку выбирает библиотека.
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
 *
 * Иллюстрация — иконка `lucide` (AR-190). Проп `glyph` оставлен ради
 * совместимости с экранами, написанными до 1.3.0, и НЕ читается.
 */
export function EmptyState({
  title,
  hint,
  action,
  testId,
  icon = "doc",
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  testId?: string;
  icon?: IconName;
  /** @deprecated с 1.3.0 — игнорируется, используйте `icon` (AR-190). */
  glyph?: string;
}) {
  return (
    <div className="sch-state" data-testid={testId}>
      <div className="sch-state-illustration" aria-hidden="true">
        <Icon name={icon} size={24} />
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

/**
 * Тост на `Toast` Radix: область уведомлений с `role="region"` и горячей
 * клавишей, сам тост — `role="status"` с живой областью, свайп вниз закрывает.
 * Время жизни считает `useToast` (4 секунды, максимум один — §5): библиотечный
 * таймер выключен, чтобы два таймера не спорили, кто гасит.
 */
export function Toast({ text }: { text: string }) {
  return (
    <ToastPrimitive.Provider swipeDirection="down" label="Уведомления ({hotkey})">
      <ToastPrimitive.Root className="sch-toast" data-testid="toast" defaultOpen duration={Infinity}>
        <ToastPrimitive.Description>{text}</ToastPrimitive.Description>
      </ToastPrimitive.Root>
      <ToastPrimitive.Viewport className="sch-portal sch-toasts" />
    </ToastPrimitive.Provider>
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

/**
 * Аватар на `Avatar` Radix: картинка показывается только после загрузки,
 * до неё и при ошибке — инициалы; без библиотеки битая ссылка на фото
 * рисовала пустую рамку с alt-текстом.
 */
export function Avatar({ name, url, large }: { name: string | null; url?: string | null; large?: boolean }) {
  const cls = large ? "sch-avatar sch-avatar--lg" : "sch-avatar";
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <AvatarPrimitive.Root className={cls} aria-hidden={name ? undefined : true}>
      {url ? <AvatarPrimitive.Image className="sch-avatar-img" src={url} alt={name ?? ""} /> : null}
      <AvatarPrimitive.Fallback delayMs={url ? 300 : 0}>{initials || "·"}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/**
 * Бейдж — статус словом. Тон кодирует СМЫСЛ, а не украшает (AR-80): `success`
 * — сделано/в сети, `warning` — ждёт человека, `danger` — закрыто/отозвано,
 * `muted` — неактивно. Цвет один смысла не несёт: слово стоит всегда.
 */
export type BadgeTone = "brand" | "muted" | "success" | "warning" | "danger";

export function Badge({ children, muted, tone, testId }: { children: ReactNode; muted?: boolean; tone?: BadgeTone; testId?: string }) {
  const t: BadgeTone = tone ?? (muted ? "muted" : "brand");
  return (
    <span className={t === "brand" ? "sch-badge" : `sch-badge sch-badge--${t}`} data-testid={testId}>
      {children}
    </span>
  );
}

// ─────────────────────────── общие блоки кабинетов (AR-186, AR-190) ───────────────────────────

/**
 * Плитка показателя: число крупно, подпись мелко. Плитки живут только в
 * сетке `StatGrid` и никогда не декорируются иконкой — число и есть акцент.
 */
export function Stat({ value, label, tone, testId }: { value: ReactNode; label: string; tone?: BadgeTone; testId?: string }) {
  return (
    <div className={tone && tone !== "brand" ? `sch-stat sch-stat--${tone}` : "sch-stat"} data-testid={testId}>
      <span className="sch-stat-value">{value}</span>
      <span className="sch-stat-label">{label}</span>
    </div>
  );
}

export function StatGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="sch-stats" data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * Навигация разделов внутри экрана (`S-62.subnav`): вкладки с подчёркиванием
 * в ряд на десктопе, лента с прокруткой внутри контейнера на мобайле (§6).
 * Активный раздел — `aria-current`, а не класс: смок читает атрибут.
 */
export function SubNav<K extends string>({
  items,
  active,
  onChange,
  testId,
}: {
  items: { key: K; label: string; icon?: IconName }[];
  active: K;
  onChange: (k: K) => void;
  testId?: string;
}) {
  return (
    <nav className="sch-subnav" data-testid={testId} aria-label="Разделы">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className="sch-subnav-item"
          aria-current={it.key === active ? "page" : undefined}
          data-key={it.key}
          onClick={() => onChange(it.key)}
        >
          {it.icon ? <Icon name={it.icon} size={18} /> : null}
          {it.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * Поле «скопировать»: значение моноширинно, кнопка одна. Успех показывается
 * подписью кнопки «Скопировано» на две секунды — тост здесь был бы шумом (§5).
 */
export function CopyField({ value, label, testId }: { value: string; label?: string; testId?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      window.prompt("Скопируйте вручную", value);
    }
  };
  return (
    <div className="sch-copy" data-testid={testId}>
      {label ? <span className="sch-copy-label">{label}</span> : null}
      <div className="sch-copy-row">
        <code className="sch-copy-value" title={value}>
          {value}
        </code>
        {/* Без aria-label: он перекрывал бы видимую подпись, и читалка не
            услышала бы смену «Скопировать» → «Скопировано». Смену объявляет
            aria-live. */}
        <Button kind="secondary" onClick={copy} testId={testId ? `${testId}.copy` : undefined}>
          <Icon name={done ? "check" : "copy"} size={18} />
          <span aria-live="polite">{done ? "Скопировано" : "Скопировать"}</span>
        </Button>
      </div>
    </div>
  );
}

/** Точка состояния рядом со словом: «в сети», «завершена». Слово обязательно. */
export function StatusDot({ tone }: { tone: BadgeTone }) {
  return <span className={`sch-dot sch-dot--${tone}`} aria-hidden="true" />;
}

/**
 * Строка-ссылка списка (`S-82.nav`, `S-62.overview.links`): подпись, деталь,
 * шеврон справа — один шаблон на все списки переходов.
 */
export function LinkRow({ icon, label, hint, onClick, testId }: { icon?: IconName; label: string; hint?: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="sch-linkrow" onClick={onClick} data-testid={testId}>
      {icon ? (
        <span className="sch-linkrow-icon">
          <Icon name={icon} />
        </span>
      ) : null}
      <span className="sch-linkrow-text">
        <span className="sch-linkrow-label">{label}</span>
        {hint ? <span className="sch-linkrow-hint">{hint}</span> : null}
      </span>
      <Icon name="chevronRight" size={18} className="sch-linkrow-chevron" />
    </button>
  );
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
