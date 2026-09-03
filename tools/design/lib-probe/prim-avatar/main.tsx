import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Avatar from "@radix-ui/react-avatar";
import "./styles.css";
function App() {
  return (
    <Avatar.Root className="sch-avatar"><Avatar.Image src="/x.png" alt="" /><Avatar.Fallback delayMs={300}>ИМ</Avatar.Fallback></Avatar.Root>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
