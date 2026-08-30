import { Icon } from "@/design/Icon";
import type { TeacherProfile } from "@edustore/shared";
import { NAV_SECTIONS } from "./nav";

// Зона 1: левый сайдбар, два состояния (развёрнут / только иконки).
export function LeftSidebar({
  active,
  onSelect,
  expanded,
  profile,
}: {
  active: string;
  onSelect: (id: string) => void;
  expanded: boolean;
  profile: TeacherProfile | null;
}) {
  return (
    <aside className={"zone zone-left" + (expanded ? " is-expanded" : "")}>
      <div className="ls-brand">
        <div className="brand-mark">E</div>
        <span className="brand-word">EduStore</span>
      </div>
      <nav className="ls-nav">
        {NAV_SECTIONS.map((s) => (
          <button
            key={s.id}
            className={"ls-item" + (active === s.id ? " is-active" : "")}
            onClick={() => onSelect(s.id)}
            title={s.label}
          >
            {active === s.id && <span className="ls-pill" />}
            <span className="ls-ico"><Icon name={s.icon} size={21} /></span>
            <span className="ls-lbl">{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="ls-foot">
        <button className="avatar" title={profile?.displayName}>{profile?.initials ?? "—"}</button>
        <span className="ls-user">
          <b>{profile?.displayName ?? "…"}</b>
          <span>{profile?.role ?? ""}</span>
        </span>
      </div>
    </aside>
  );
}
