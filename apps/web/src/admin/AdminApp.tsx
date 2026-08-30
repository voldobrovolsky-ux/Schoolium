import { useState } from "react";
import { Icon } from "./ds/Icon";
import { Avatar } from "./ds/components";
import { ADMIN_SECTIONS } from "./registry";
import { useCurrentUser } from "@/cabinets/CurrentUser";

/**
 * Панель управления школой. 3-зонная оболочка дизайн-системы EduStore:
 * левый сайдбар (15%) — разделы · рабочий экран (65%) · правый сайдбар (20%) — подразделы.
 * Метро-навигации нет (она только у учителя). Школа и админ — из сессии Флёруса, не мок.
 */
export function AdminApp() {
  const { user } = useCurrentUser();
  const [sectionId, setSectionId] = useState(ADMIN_SECTIONS[0].id);
  const [subId, setSubId] = useState(ADMIN_SECTIONS[0].subsections[0].id);

  const section = ADMIN_SECTIONS.find((s) => s.id === sectionId) ?? ADMIN_SECTIONS[0];
  const sub = section.subsections.find((s) => s.id === subId) ?? section.subsections[0];
  const Screen = sub.Screen;

  const selectSection = (id: string) => {
    const s = ADMIN_SECTIONS.find((x) => x.id === id)!;
    setSectionId(id);
    setSubId(s.subsections[0].id);
  };

  return (
    <div className="eds-admin">
      <div className="adm-shell">
        {/* зона 1 — разделы */}
        <aside className="adm-rail">
          <div className="adm-brand">
            <span className="adm-brand__logo"><Icon name="graduation-cap" size={20} /></span>
            <div>
              <div className="adm-brand__name">{user.orgName}</div>
              <div className="adm-brand__sub">Панель управления</div>
            </div>
          </div>
          <div className="adm-overline">Разделы</div>
          <nav className="adm-nav">
            {ADMIN_SECTIONS.map((s) => (
              <button key={s.id} className={"adm-nav__item" + (s.id === sectionId ? " is-active" : "")} onClick={() => selectSection(s.id)}>
                <span className="adm-nav__tile" style={{ background: `linear-gradient(145deg, ${s.gradient[0]}, ${s.gradient[1]})`, boxShadow: `0 2px 6px ${s.gradient[0]}44, 0 0 0 1px rgba(255,255,255,.3) inset` }}>
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
              <div className="adm-foot__role">администратор</div>
            </div>
          </div>
        </aside>

        {/* зона 2 — рабочий экран */}
        <main className="adm-work">
          <Screen />
        </main>

        {/* зона 3 — подразделы активного раздела */}
        <aside className="adm-aside">
          <div className="adm-overline" style={{ padding: "2px 8px 10px" }}>{section.label}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {section.subsections.map((s) => (
              <button key={s.id} className={"adm-sub" + (s.id === subId ? " is-active" : "")} onClick={() => setSubId(s.id)}>
                <span>{s.label}</span>
                {s.id === subId && <span className="adm-sub__dot" style={{ background: "var(--accent)" }} />}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
