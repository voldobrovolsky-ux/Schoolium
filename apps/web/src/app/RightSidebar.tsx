import type { ReactNode } from "react";
import { Icon, type IconName } from "@/design/Icon";

export interface SectionTab {
  id: string;
  label: string;
  icon: IconName;
}

// Зона 4: единый правый сайдбар. Верх — разделы РП, низ — инструменты раздела.
export function RightSidebar({
  sections,
  active,
  onSelect,
  children,
}: {
  sections: SectionTab[];
  active: string;
  onSelect: (id: string) => void;
  children?: ReactNode;
}) {
  return (
    <aside className="zone zone-right">
      <div className="rs-cap">Разделы</div>
      <nav className="rs-group">
        {sections.map((s) => (
          <button
            key={s.id}
            className={"rs-item" + (active === s.id ? " is-active" : "")}
            onClick={() => onSelect(s.id)}
          >
            {active === s.id && <span className="rs-pill" />}
            <span className="rs-ico"><Icon name={s.icon} size={19} /></span>
            <span className="rs-lbl">{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="rs-div" />
      {children}
    </aside>
  );
}
