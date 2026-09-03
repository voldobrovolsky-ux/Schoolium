import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import "./styles.css";
function App() {
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState(false);
  return (
    <div className="sch">
      <button className="sch-btn" data-testid="S-1.btn" onClick={() => setOpen(true)}>Открыть</button>
      <input className="sch-input" data-testid="S-1.input" />
      <select className="sch-input"><option>А</option><option>Б</option></select>
      <span className="sch-badge">бейдж</span>
      <button className="sch-btn" onClick={() => setPop((v) => !v)}>Поповер</button>
      {pop ? <div className="sch-popover" role="dialog">поповер</div> : null}
      {open ? (
        <div className="sch-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="sch-modal" role="dialog" aria-modal="true" data-testid="M-1">
            <h2>Заголовок</h2>
            <button className="sch-btn" onClick={() => setOpen(false)} aria-label="Закрыть"><X size={20} /></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
