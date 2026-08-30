import { useState } from "react";
import type { NotificationDto } from "@edustore/shared";
import { Icon } from "@/design/Icon";
import type { ToastInput } from "@/sections/types";

const NOTIF_FILTERS = [
  { id: "all", label: "Все" },
  { id: "urgent", label: "Срочные" },
  { id: "journal", label: "Журнал" },
  { id: "ktp", label: "КТП" },
];

export function NotificationPanel({
  items,
  onClose,
  pushToast,
}: {
  items: NotificationDto[];
  onClose: () => void;
  pushToast: (t: ToastInput) => void;
}) {
  const [filter, setFilter] = useState("all");
  // тип в DTO — верхний регистр (enum БД); CSS-классы и тосты — нижний.
  const lc = (t: string) => t.toLowerCase() as ToastInput["type"];
  const list = items.filter((n) =>
    filter === "all" ? true : filter === "urgent" ? n.type === "URGENT" : n.category === filter,
  );
  return (
    <>
      <div className="notif-scrim" onClick={onClose} />
      <aside className="notif-panel">
        <div className="np-head">
          <h3>Уведомления</h3>
          <button className="ghost-ico" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <div className="np-filters">
          {NOTIF_FILTERS.map((f) => (
            <button
              key={f.id}
              className={"np-filter" + (filter === f.id ? " on" : "")}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="np-list">
          {list.map((n) => (
            <div
              key={n.id}
              className={"np-card " + lc(n.type)}
              onClick={() => pushToast({ type: lc(n.type), title: n.title, msg: n.message })}
            >
              <div className="np-ico"><Icon name={n.icon} size={18} /></div>
              <div className="np-body">
                <div className="np-t">{n.title}</div>
                <div className="np-m">{n.message}</div>
                <div className="np-time">{n.time}</div>
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div style={{ padding: "24px 12px", color: "var(--ink3)", fontSize: 13, textAlign: "center" }}>
              Нет уведомлений
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
