import type { SectionDescriptor } from "@/sections/types";
import { JournalProvider } from "./context";
import { JournalScreen } from "./JournalScreen";
import { JournalTools } from "./JournalTools";

// Раздел «Журнал»: таблица оценок + голосовой ввод. Метро не нужно.
export const journalSection: SectionDescriptor = {
  id: "journal",
  label: "Журнал",
  icon: "journal",
  hasMetro: false,
  Provider: JournalProvider,
  Work: JournalScreen,
  RightTools: JournalTools,
};
