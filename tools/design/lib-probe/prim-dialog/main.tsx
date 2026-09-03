import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import "./styles.css";
function App() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="sch-btn">Открыть</Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="sch-overlay" /><Dialog.Content className="sch-modal"><Dialog.Title>Заголовок</Dialog.Title><Dialog.Close className="sch-btn">Закрыть</Dialog.Close></Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
