import type { SectionDescriptor } from "@/sections/types";
import { PlanningProvider } from "./context";
import { PlanningNav } from "./PlanningNav";
import { PlanningScreen } from "./PlanningScreen";
import { PlanningTools } from "./PlanningTools";

// Раздел «ПП» (поурочное планирование): метро-ветка уроков + рабочий экран темы.
export const planningSection: SectionDescriptor = {
  id: "pp",
  label: "ПП",
  icon: "pp",
  hasMetro: true,
  Provider: PlanningProvider,
  Nav: PlanningNav,
  Work: PlanningScreen,
  RightTools: PlanningTools,
};
