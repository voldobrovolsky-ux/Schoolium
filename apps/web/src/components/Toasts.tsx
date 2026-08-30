import { Icon } from "@/design/Icon";
import type { ToastInput } from "@/sections/types";

export interface Toast extends ToastInput {
  id: number;
}

function ToastCard({ t, onClose }: { t: Toast; onClose: (id: number) => void }) {
  const ico = t.type === "urgent" ? "alert" : t.type === "normal" ? "bell" : "info";
  return (
    <div className={"toast " + t.type}>
      <div className="toast-strip" />
      <div className="toast-ico"><Icon name={ico} size={21} /></div>
      <div className="toast-body">
        <div className="toast-title">{t.title}</div>
        {t.msg && <div className="toast-msg">{t.msg}</div>}
      </div>
      <button className="toast-x" onClick={() => onClose(t.id)}><Icon name="x" size={16} /></button>
    </div>
  );
}

export function ToastStack({ toasts, remove }: { toasts: Toast[]; remove: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => <ToastCard key={t.id} t={t} onClose={remove} />)}
    </div>
  );
}
