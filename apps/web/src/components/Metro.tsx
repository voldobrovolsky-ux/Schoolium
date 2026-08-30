import { useRef } from "react";
import type { LessonStation } from "@edustore/shared";

// Зона 2: метро-навигация по урокам (станции). Перенос из дизайн-референса.
const STATION_GAP = 92; // px между станциями

function StationGlyph({ type, active }: { type: LessonStation["type"]; active: boolean }) {
  // урок = точка, тест = заполненный круг, контрольная = кольцо
  if (type === "CONTROL") {
    return (
      <span className={"glyph glyph-control" + (active ? " on" : "")}>
        <svg width="26" height="26" viewBox="0 0 26 26">
          <circle cx="13" cy="13" r="9.5" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.28" />
          <circle
            cx="13" cy="13" r="9.5" fill="none" stroke="currentColor" strokeWidth="3"
            strokeLinecap="round" strokeDasharray="60" strokeDashoffset="38"
            transform="rotate(-90 13 13)"
          />
        </svg>
      </span>
    );
  }
  if (type === "TEST") {
    return <span className={"glyph glyph-test" + (active ? " on" : "")} />;
  }
  return <span className={"glyph glyph-lesson" + (active ? " on" : "")} />;
}

export function Metro({
  lessons,
  activeIndex,
  setActiveIndex,
}: {
  lessons: LessonStation[];
  activeIndex: number;
  setActiveIndex: (updater: (i: number) => number) => void;
}) {
  const lockRef = useRef(false);

  const onWheel = (e: React.WheelEvent) => {
    if (lockRef.current) return;
    if (Math.abs(e.deltaY) < 4) return;
    lockRef.current = true;
    const dir = e.deltaY > 0 ? 1 : -1;
    setActiveIndex((i) => Math.max(0, Math.min(lessons.length - 1, i + dir)));
    setTimeout(() => (lockRef.current = false), 220);
  };

  return (
    <div className="zone zone-metro" onWheel={onWheel}>
      <div className="metro-fade metro-fade-top" />
      <div className="metro-fade metro-fade-bot" />
      <div className="metro-thread" />
      <div className="metro-stations">
        {lessons.map((l, i) => {
          const offset = i - activeIndex;
          const dist = Math.abs(offset);
          if (dist > 3) return null;
          const active = offset === 0;
          const op = active ? 1 : dist === 1 ? 0.7 : dist === 2 ? 0.4 : 0.2;
          const pos = active ? " is-active" : offset < 0 ? " is-past" : " is-future";
          return (
            <button
              key={l.id}
              className={"station" + pos}
              style={{
                transform: `translateY(calc(-50% + ${offset * STATION_GAP}px)) scale(${active ? 1.0 : 0.92})`,
                opacity: op,
                pointerEvents: dist > 2 ? "none" : "auto",
              }}
              onClick={() => setActiveIndex(() => i)}
            >
              <span className="station-node">
                <StationGlyph type={l.type} active={active} />
              </span>
              <span className="station-text">
                <span className="station-title">{l.short}</span>
                <span className="station-sub">
                  {l.type === "TEST" ? "Тест" : l.type === "CONTROL" ? "Контрольная" : "Урок " + (i + 1)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
