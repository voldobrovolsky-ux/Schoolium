import { useState } from "react";
import { Icon, type IconName } from "@/design/Icon";
import type { SectionProps } from "@/sections/types";
import { usePlanning } from "./context";

// Инструменты текущего раздела (ПП). Из дизайн-референса + блок текущего урока (ТЗ).
const TOOLS: { id: string; label: string; icon: IconName }[] = [
  { id: "calendar", label: "Календарь", icon: "calendar" },
  { id: "conspect", label: "Конспект", icon: "conspect" },
  { id: "deck", label: "Презентация", icon: "presentation" },
  { id: "control", label: "Контрольные", icon: "clipboardGen" },
  { id: "notes", label: "Заметки", icon: "notes" },
];

export function PlanningTools(_: SectionProps) {
  const { detail } = usePlanning();
  const [active, setActive] = useState<string | null>(null);

  return (
    <>
      <div className="rs-cap">Инструменты</div>
      <nav className="rs-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={"rs-item" + (active === t.id ? " is-active" : "")}
            onClick={() => setActive(t.id)}
          >
            <span className="rs-ico"><Icon name={t.icon} size={19} /></span>
            <span className="rs-lbl">{t.label}</span>
          </button>
        ))}
      </nav>

      {detail && (
        <>
          <div className="rs-div" />
          <div className="rs-cap">Текущий урок</div>
          <div className="rs-summary">
            {detail.pageStart && detail.pageEnd && (
              <div className="rs-stat">
                <span className="rs-stat-lbl">Страницы</span>
                <span className="rs-stat-val">{detail.pageStart}–{detail.pageEnd}</span>
              </div>
            )}
            <div className="rs-stat">
              <span className="rs-stat-lbl">Прохождение</span>
              <span className="rs-stat-val">{detail.metrics.progress}%</span>
            </div>
            <div className="rs-stat">
              <span className="rs-stat-lbl">Урок №</span>
              <span className="rs-stat-val">{detail.lessonNumber}</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
