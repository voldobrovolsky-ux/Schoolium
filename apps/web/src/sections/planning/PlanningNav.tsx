import { useEffect } from "react";
import { Metro } from "@/components/Metro";
import type { SectionProps } from "@/sections/types";
import { usePlanning } from "./context";

// Зона 2 для ПП: метро-ветка уроков + навигация стрелками.
export function PlanningNav(_: SectionProps) {
  const { lessons, activeIndex, setActiveIndex } = usePlanning();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => i + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => i - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setActiveIndex]);

  return <Metro lessons={lessons} activeIndex={activeIndex} setActiveIndex={setActiveIndex} />;
}
