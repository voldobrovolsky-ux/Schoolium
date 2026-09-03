import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as Toast from "@radix-ui/react-toast";
import * as Tooltip from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import "./styles.css";
function App() {
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState<DOMRect | null>(null);
  const [toast, setToast] = useState(false);
  const virtual = useRef({ getBoundingClientRect: () => pop ?? new DOMRect() });
  return (
    <Tooltip.Provider>
      <div className="sch">
        <button className="sch-btn" data-testid="S-1.btn" onClick={() => setOpen(true)}>Открыть</button>
        <input className="sch-input" data-testid="S-1.input" />
        <select className="sch-input"><option>А</option><option>Б</option></select>
        <span className="sch-badge">бейдж</span>
        <button className="sch-btn" onClick={(e) => setPop(e.currentTarget.getBoundingClientRect())}>Поповер</button>
        <Popover.Root open={!!pop} onOpenChange={(o) => !o && setPop(null)}>
          <Popover.Anchor virtualRef={virtual} />
          <Popover.Portal><Popover.Content className="sch-popover" data-testid="M-7">поповер<Popover.Arrow /></Popover.Content></Popover.Portal>
        </Popover.Root>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="sch-overlay" />
            <Dialog.Content className="sch-modal" data-testid="M-1">
              <Dialog.Title>Заголовок</Dialog.Title>
              <Dialog.Close className="sch-btn" aria-label="Закрыть"><X size={20} /></Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <Toast.Provider swipeDirection="down">
          <button className="sch-btn" onClick={() => setToast(true)}>Тост</button>
          <Toast.Root className="sch-toast" open={toast} onOpenChange={setToast}><Toast.Description>Сохранено</Toast.Description></Toast.Root>
          <Toast.Viewport className="sch-toasts" />
        </Toast.Provider>
        <Tooltip.Root><Tooltip.Trigger className="sch-btn">?</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="sch-tooltip">подсказка</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
      </div>
    </Tooltip.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
