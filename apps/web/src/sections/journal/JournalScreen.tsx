import { useEffect, useRef, useState } from "react";
import type { GradeValue, JournalRow } from "@edustore/shared";
import { gradeClass } from "@edustore/shared";
import { Icon } from "@/design/Icon";
import { VoiceOverlay } from "@/components/VoiceOverlay";
import type { SectionProps } from "@/sections/types";
import { useJournal } from "./context";

const GRADE_OPTIONS: GradeValue[] = ["5", "4", "3", "2", "н"];

function GradePicker({ onPick, onClose }: { onPick: (v: GradeValue) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div className="grade-pop" ref={ref} onClick={(e) => e.stopPropagation()}>
      {GRADE_OPTIONS.map((v) => (
        <button key={v} className={"gp-opt " + gradeClass(v)} onClick={() => onPick(v)}>{v}</button>
      ))}
      <button className="gp-opt gp-clear" onClick={() => onPick("")} title="Очистить"><Icon name="x" size={14} /></button>
    </div>
  );
}

export function JournalScreen({ ctx }: SectionProps) {
  const { data, loading, error, latestLessonId, flash, setGrade } = useJournal();
  const [edit, setEdit] = useState<string | null>(null); // "studentId|lessonId"
  const [voiceOpen, setVoiceOpen] = useState(false);

  const q = (ctx.searchQuery || "").trim().toLowerCase();
  const rows: JournalRow[] = (data?.rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  const label = ctx.assignment?.label ?? data?.classLabel ?? "";
  const subject = ctx.assignment?.subject ?? data?.subject ?? "";

  return (
    <main className="journal">
      <div className="work-inner work-anim">
        <div className="journal-bar">
          <div>
            <h1>Журнал · {label}</h1>
            <div className="jb-sub">{subject} · сентябрь 2025 · {data?.summary.count ?? 0} учеников</div>
          </div>
          <button
            className={"mic-btn" + (voiceOpen ? " recording" : "")}
            onClick={() => latestLessonId && setVoiceOpen(true)}
            title="Голосовой ввод оценок"
          >
            <Icon name="mic" size={21} />
          </button>
        </div>

        {loading && <div className="placeholder"><span>Загрузка журнала…</span></div>}
        {error && <div className="placeholder"><b>{error}</b><span>API недоступен — запустите apps/api</span></div>}

        {data && (
          <div className="jtable-wrap">
            <table className="jtable">
              <thead>
                <tr>
                  <th className="jth-name">Ученик</th>
                  {data.columns.map((c) => (
                    <th key={c.lessonId} className="jth-date">
                      <div className="jth-date">
                        <div className="jd-day">{c.day}</div>
                        <div className="jd-wd">{c.wd}</div>
                      </div>
                    </th>
                  ))}
                  <th className="jth-avg">Средн.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.studentId}>
                    <td className="jcell-name">
                      <div className="jname">
                        <span className="jn-num">{r.number}</span>
                        <span className="jn-full">{r.name}</span>
                      </div>
                    </td>
                    {data.columns.map((c, di) => {
                      const g = r.grades[di] ?? "";
                      const key = `${r.studentId}|${c.lessonId}`;
                      return (
                        <td key={c.lessonId} className="jcell" onClick={() => setEdit(key)}>
                          {g && <span className={"jmark " + gradeClass(g) + (flash === key ? " fly" : "")}>{g}</span>}
                          {!g && <span className="jmark-empty">+</span>}
                          {edit === key && (
                            <GradePicker
                              onPick={(v) => { setGrade(r.studentId, c.lessonId, v); setEdit(null); }}
                              onClose={() => setEdit(null)}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="jcell-avg">{r.avg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {voiceOpen && latestLessonId && ctx.assignment && (
        <VoiceOverlay
          classId={ctx.assignment.classId}
          lessonId={latestLessonId}
          onConfirm={(studentId, grade) => {
            setGrade(studentId, latestLessonId, grade);
            setVoiceOpen(false);
            const who = data?.rows.find((r) => r.studentId === studentId)?.name ?? "";
            ctx.pushToast({ type: "normal", title: "Оценка выставлена", msg: `${who} → ${grade}` });
          }}
          onCancel={() => setVoiceOpen(false)}
        />
      )}
    </main>
  );
}
