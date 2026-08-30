import { useState } from "react";
import { Icon } from "@/design/Icon";
import { usePrefs, type Density } from "@/app/prefs";

const STATUS_COLORS: Record<string, string[]> = {
  good: ["#DCFCE7", "#D1FAE5", "#DBEAFE", "#E0E7FF"],
  mid: ["#FEF9C3", "#FEF3C7", "#FFEDD5", "#F3E8FF"],
  bad: ["#FEE2E2", "#FFE4E6", "#FCE7F3", "#FEF2F2"],
  absent: ["#F1F5F9", "#E2E8F0", "#F5F5F4", "#ECFEFF"],
};
const STATUS_LABELS: Record<string, string> = {
  good: "Оценки 5 и 4",
  mid: "Оценка 3",
  bad: "Оценка 2",
  absent: "Не был (н)",
};
const DENSITIES: [Density, string][] = [
  ["compact", "Компактный"],
  ["standard", "Стандартный"],
  ["spacious", "Просторный"],
];

export function JournalSettings({ onClose }: { onClose: () => void }) {
  const { density, set } = usePrefs();
  const [colors, setColors] = useState<Record<string, number>>({ good: 0, mid: 0, bad: 0, absent: 0 });

  const setColor = (status: string, ix: number) => {
    setColors((c) => ({ ...c, [status]: ix }));
    document.documentElement.style.setProperty(`--g-${status}-bg`, STATUS_COLORS[status][ix]);
  };

  return (
    <>
      <div className="notif-scrim" onClick={onClose} />
      <aside className="js-panel">
        <div className="np-head">
          <h3>Настройки журнала</h3>
          <button className="ghost-ico" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <div className="js-body">
          <div className="js-sec">
            <h4>Цветовые индикаторы</h4>
            {Object.keys(STATUS_LABELS).map((st) => (
              <div key={st} className="js-color-row">
                <span className="jc-lbl">{STATUS_LABELS[st]}</span>
                <div className="js-swatches">
                  {STATUS_COLORS[st].map((c, ix) => (
                    <button
                      key={ix}
                      className={"js-sw" + (colors[st] === ix ? " on" : "")}
                      style={{ background: c }}
                      onClick={() => setColor(st, ix)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="js-sec">
            <h4>Внешний вид</h4>
            <div className="segmented">
              {DENSITIES.map(([v, l]) => (
                <button key={v} className={density === v ? "on" : ""} onClick={() => set("density", v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
