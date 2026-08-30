import type { SectionDescriptor } from "@/sections/types";
import { BriefTestScreen } from "./BriefTestScreen";

/** Летучка: печать листов с кодами (реальный window.print) → проверка → assessment.checked → ИОМ. */
export const brieftestSection: SectionDescriptor = {
  id: "brieftest",
  label: "Летучка",
  icon: "test",
  Work: BriefTestScreen,
};
