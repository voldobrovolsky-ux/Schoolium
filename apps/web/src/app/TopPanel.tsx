import type { TeacherClass } from "@edustore/shared";
import { Icon } from "@/design/Icon";

// Верхняя панель: инструменты (поиск/уведомления) + флажки классов.
export function TopPanel({
  classes,
  activeClassId,
  onSelectClass,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  onBell,
  notifCount,
}: {
  classes: TeacherClass[];
  activeClassId: string | null;
  onSelectClass: (c: TeacherClass) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  onBell: () => void;
  notifCount: number;
}) {
  return (
    <div className="top-panel">
      <div className="tabs">
        <div className="top-tools">
          {searchOpen ? (
            <div className="search-box">
              <Icon name="search" size={16} />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по ученикам…"
              />
              <button className="sb-x" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}>
                <Icon name="x" size={15} />
              </button>
            </div>
          ) : (
            <button className="ghost-ico" title="Поиск" onClick={() => setSearchOpen(true)}>
              <Icon name="search" size={18} />
            </button>
          )}
          <button className="ghost-ico" title="Уведомления" onClick={onBell}>
            <Icon name="bell" size={18} />
            {notifCount > 0 && <span className="dot-badge" />}
          </button>
        </div>
      </div>
      <div className="flags">
        {classes.map((c) => (
          <button
            key={c.id}
            className={"flag" + (activeClassId === c.classId ? " is-active" : "")}
            onClick={() => onSelectClass(c)}
          >
            <span className="flag-label">{c.label}</span>
            <span className="flag-sub">{c.subject}</span>
            <span className="flag-count">{c.students}</span>
          </button>
        ))}
        <button className="flag flag-add" title="Добавить класс"><Icon name="plus" size={18} /></button>
      </div>
    </div>
  );
}
