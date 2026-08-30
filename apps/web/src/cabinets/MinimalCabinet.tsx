import { useState } from "react";
import { Icon, type IconName } from "@/admin/ds/Icon";
import { Avatar, Badge } from "@/admin/ds/components";
import type { CabinetDef } from "./roleRegistry";
import type { CurrentUser } from "./CurrentUser";

/**
 * Минимальный кабинет роли: левый сайдбар (разделы — только навигация) +
 * главная (приветствие, имя, роль). Контент разделов — заглушки (наполняется позже).
 * На дизайн-системе EduStore (frosted glass).
 */
export function MinimalCabinet({ def, user }: { def: CabinetDef; user: CurrentUser }) {
  const nav: { id: string; label: string; icon: IconName }[] = [
    { id: "home", label: "Главная", icon: "home" },
    ...def.sections,
  ];
  const [active, setActive] = useState("home");
  const firstName = user.name.split(/\s+/)[1] ?? user.name; // "Соколова Анна" → "Анна"
  const section = def.sections.find((s) => s.id === active);
  const SectionScreen = section?.Screen;

  return (
    <div className="eds-admin">
      <div className="adm-shell">
        <aside className="adm-rail">
          <div className="adm-brand">
            <span className="adm-brand__logo" style={{ background: `linear-gradient(145deg, ${def.gradient[0]}, ${def.gradient[1]})` }}>
              <Icon name="graduation-cap" size={20} />
            </span>
            <div>
              <div className="adm-brand__name">{user.orgName}</div>
              <div className="adm-brand__sub">{def.roleLabel}</div>
            </div>
          </div>
          <div className="adm-overline">Разделы</div>
          <nav className="adm-nav">
            {nav.map((s) => (
              <button key={s.id} className={"adm-nav__item" + (active === s.id ? " is-active" : "")} onClick={() => setActive(s.id)}>
                <span className="adm-nav__tile" style={{ background: `linear-gradient(145deg, ${def.gradient[0]}, ${def.gradient[1]})`, boxShadow: `0 2px 6px ${def.gradient[0]}44, 0 0 0 1px rgba(255,255,255,.3) inset` }}>
                  <Icon name={s.icon} size={16} strokeWidth={2.1} />
                </span>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="adm-foot">
            <Avatar name={user.name} size="sm" />
            <div>
              <div className="adm-foot__name">{user.name}</div>
              <div className="adm-foot__role">{def.roleLabel.toLowerCase()}</div>
            </div>
          </div>
        </aside>

        <main className="adm-work">
          {active === "home" ? (
            <div style={{ maxWidth: 760 }}>
              <div className="adm-panel" style={{ padding: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <Avatar name={user.name} size="lg" />
                  <div>
                    <h1 style={{ fontSize: "var(--text-2xl)" }}>Здравствуйте, {firstName}</h1>
                    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                      <Badge tone="accent">{def.roleLabel}</Badge>
                      <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{user.orgName}</span>
                    </div>
                  </div>
                </div>
                <p style={{ marginTop: 18, color: "var(--text-body)", fontSize: "var(--text-md)" }}>
                  {def.label}. Разделы — в меню слева. Наполнение появится по мере настройки системы.
                </p>
              </div>
              <div className="adm-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", marginTop: 16 }}>
                {def.sections.map((s) => (
                  <button key={s.id} className="adm-panel" style={{ padding: 18, textAlign: "left", cursor: "pointer", border: "1px solid var(--glass-border)" }} onClick={() => setActive(s.id)}>
                    <span style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: def.gradient[0], background: `color-mix(in oklch, ${def.gradient[0]} 14%, var(--surface-card))` }}>
                      <Icon name={s.icon} size={20} />
                    </span>
                    <div style={{ marginTop: 12, fontWeight: 600, color: "var(--text-strong)" }}>{s.label}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : SectionScreen ? (
            <SectionScreen />
          ) : (
            <div className="placeholder" style={{ height: "100%", background: "transparent" }}>
              <div className="ph-ico" style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>
                <Icon name={section?.icon ?? "circle"} size={28} />
              </div>
              <b>{section?.label}</b>
              <span>Раздел в разработке</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
