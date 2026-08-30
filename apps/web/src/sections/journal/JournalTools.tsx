import { useState } from "react";
import { Icon } from "@/design/Icon";
import type { SectionProps } from "@/sections/types";
import { useJournal } from "./context";
import { JournalSettings } from "./JournalSettings";

// Нижний блок правого сайдбара для журнала: сводка класса + настройки + отчёт.
export function JournalTools({ ctx }: SectionProps) {
  const { data } = useJournal();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const s = data?.summary;

  return (
    <>
      <div className="rs-cap">Сводка по классу</div>
      <div className="rs-summary">
        <div className="rs-stat">
          <span className="rs-stat-lbl">Средний балл</span>
          <span className="rs-stat-val good">{s?.avg ?? "—"}</span>
        </div>
        <div className="rs-stat">
          <span className="rs-stat-lbl">Посещаемость</span>
          <span className="rs-stat-val">{s?.attendance ?? 0}%</span>
        </div>
        <div className="rs-stat">
          <span className="rs-stat-lbl">Учеников</span>
          <span className="rs-stat-val">{s?.count ?? 0}</span>
        </div>
      </div>
      <button className="rs-gear" onClick={() => setSettingsOpen(true)}>
        <Icon name="gear" size={18} /> Настройки журнала
      </button>
      <div className="rs-spring" />
      <button
        className="rs-report"
        onClick={() =>
          ctx.pushToast({
            type: "info",
            title: "Отчёт формируется",
            msg: `Сводка успеваемости ${ctx.assignment?.label ?? ""} за сентябрь.`,
          })
        }
      >
        <Icon name="conspect" size={17} /> Сформировать отчёт
      </button>

      {settingsOpen && <JournalSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
