import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Select from "@radix-ui/react-select";
import "./styles.css";
function App() {
  return (
    <Select.Root defaultValue="a">
      <Select.Trigger className="sch-input"><Select.Value /><Select.Icon /></Select.Trigger>
      <Select.Portal><Select.Content className="sch-popover"><Select.Viewport><Select.Item value="a"><Select.ItemText>А</Select.ItemText></Select.Item><Select.Item value="b"><Select.ItemText>Б</Select.ItemText></Select.Item></Select.Viewport></Select.Content></Select.Portal>
    </Select.Root>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
