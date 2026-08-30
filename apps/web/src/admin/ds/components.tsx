import type {
  ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes,
} from "react";

const cx = (...c: unknown[]): string => c.filter(Boolean).join(" ");

// ── Button ──
type BtnVariant = "primary" | "secondary" | "ghost" | "create" | "danger" | "danger-soft";
export function Button({
  variant = "primary", size = "md", block, icon, iconRight, className, children, ...rest
}: { variant?: BtnVariant; size?: "sm" | "md" | "lg"; block?: boolean; icon?: ReactNode; iconRight?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx("eds-btn", `eds-btn--${size}`, variant !== "primary" && `eds-btn--${variant}`, block && "eds-btn--block", className)}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}

// ── IconButton ──
export function IconButton({
  size = "md", variant = "ghost", solid, label, className, children, ...rest
}: { size?: "sm" | "md" | "lg"; variant?: "ghost" | "accent" | "danger"; solid?: boolean; label?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx("eds-iconbtn", `eds-iconbtn--${size}`, solid && "eds-iconbtn--solid", variant === "accent" && "eds-iconbtn--accent", variant === "danger" && "eds-iconbtn--danger", className)}
      aria-label={label} title={label} {...rest}
    >
      {children}
    </button>
  );
}

// ── Card ──
export function Card({
  title, meta, actions, interactive, className, children, ...rest
}: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; interactive?: boolean; className?: string; children?: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("eds-card", interactive && "eds-card--interactive", className)} tabIndex={interactive ? 0 : undefined} {...rest}>
      <div className="eds-card__body">
        {title && <div className="eds-card__title">{title}</div>}
        {meta && <div className="eds-card__meta">{meta}</div>}
        {children}
      </div>
      {actions && <div className="eds-card__actions">{actions}</div>}
    </div>
  );
}

// ── Badge ──
export type BadgeTone = "neutral" | "accent" | "create" | "danger" | "warning";
export function Badge({ tone = "neutral", solid, dot, children }: { tone?: BadgeTone; solid?: boolean; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx("eds-badge", `eds-badge--${tone}`, solid && "eds-badge--solid")}>
      {dot && <span className="eds-badge__dot" />}
      {children}
    </span>
  );
}

// ── Avatar ──
function initials(name = "") {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p[1] ? p[1][0] : "")).toUpperCase() : "?";
}
function colorIndex(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (h % 5) + 1;
}
export function Avatar({ name = "", size = "md" }: { name?: string; size?: "xs" | "sm" | "md" | "lg" }) {
  return <span className={cx("eds-avatar", `eds-avatar--${size}`, `eds-avatar--c${colorIndex(name)}`)} title={name}>{initials(name)}</span>;
}

// ── Input ──
export function Input({
  label, hint, error, size = "md", icon, multiline, className, ...rest
}: { label?: string; hint?: string; error?: string; size?: "sm" | "md"; icon?: ReactNode; multiline?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size">) {
  const inputCls = cx("eds-input", size !== "md" && `eds-input--${size}`, icon && "eds-input--has-icon", className);
  return (
    <div className="eds-field">
      {label && <label className="eds-field__label">{label}</label>}
      <div className="eds-input-wrap">
        {icon && !multiline && <span className="eds-input-wrap__icon">{icon}</span>}
        {multiline ? <textarea className={inputCls} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} /> : <input className={inputCls} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />}
      </div>
      {(error || hint) && <span className={cx("eds-field__hint", error && "eds-field__hint--error")}>{error || hint}</span>}
    </div>
  );
}

// ── Select ──
export function Select({
  label, size = "md", options = [], placeholder, className, ...rest
}: { label?: string; size?: "sm" | "md"; options?: ({ value: string; label: string } | string)[]; placeholder?: string } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">) {
  return (
    <div className={cx("eds-select", size !== "md" && `eds-select--${size}`, className)}>
      {label && <label className="eds-select__label">{label}</label>}
      <div className="eds-select__wrap">
        <select className="eds-select__el" {...rest}>
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map((o) => {
            const opt = typeof o === "string" ? { value: o, label: o } : o;
            return <option key={opt.value} value={opt.value}>{opt.label}</option>;
          })}
        </select>
        <span className="eds-select__chev">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </div>
    </div>
  );
}

// ── Switch ──
export function Switch({ checked, onChange, disabled, label }: { checked?: boolean; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; disabled?: boolean; label?: ReactNode }) {
  return (
    <label className={cx("eds-switch", disabled && "eds-switch--disabled")}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="eds-switch__track"><span className="eds-switch__thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

// ── Checkbox / radio ──
export function Checkbox({ type = "checkbox", label, ...rest }: { type?: "checkbox" | "radio"; label?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx("eds-check", type === "radio" && "eds-check--radio")}>
      <input type={type} {...rest} />
      <span className="eds-check__box">
        {type !== "radio" && <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

// ── Tabs ──
export function Tabs({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { value: string; label: string; count?: number }[] }) {
  return (
    <div className="eds-tabs">
      {items.map((it) => (
        <button key={it.value} className={cx("eds-tab", value === it.value && "eds-tab--active")} onClick={() => onChange(it.value)}>
          {it.label}
          {it.count != null && <span className="eds-tab__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}
