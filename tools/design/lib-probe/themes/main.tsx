import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Button, Dialog, Popover, Select, TextField, Badge, Flex } from "@radix-ui/themes";
function App() {
  return (
    <Theme accentColor="violet" grayColor="mauve" radius="medium">
      <Flex gap="3">
        <Dialog.Root>
          <Dialog.Trigger><Button data-testid="S-1.btn">Открыть</Button></Dialog.Trigger>
          <Dialog.Content data-testid="M-1" maxWidth="480px">
            <Dialog.Title>Заголовок</Dialog.Title>
            <Dialog.Description>Описание</Dialog.Description>
            <Dialog.Close><Button variant="soft">Закрыть</Button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Root>
        <TextField.Root data-testid="S-1.input" placeholder="Поле" />
        <Select.Root defaultValue="a">
          <Select.Trigger />
          <Select.Content><Select.Item value="a">А</Select.Item><Select.Item value="b">Б</Select.Item></Select.Content>
        </Select.Root>
        <Badge color="violet">бейдж</Badge>
        <Popover.Root>
          <Popover.Trigger><Button variant="outline">Поповер</Button></Popover.Trigger>
          <Popover.Content>поповер</Popover.Content>
        </Popover.Root>
      </Flex>
    </Theme>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
