import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { GradeValue, JournalData } from "@edustore/shared";
import { studentAvg } from "@edustore/shared";
import { api } from "@/lib/api";
import type { SectionContext } from "@/sections/types";

interface JournalCtx {
  data: JournalData | null;
  loading: boolean;
  error: string | null;
  /** id последнего урока (колонки) — цель по умолчанию для голосового ввода. */
  latestLessonId: string | null;
  flash: string | null; // "studentId|lessonId"
  setGrade: (studentId: string, lessonId: string, value: GradeValue) => Promise<void>;
}

const Ctx = createContext<JournalCtx | null>(null);

export function JournalProvider({ ctx, children }: { ctx: SectionContext; children: ReactNode }) {
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const classId = ctx.assignment?.classId;
  const subjectId = ctx.assignment?.subjectId;

  useEffect(() => {
    if (!classId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getJournal(classId, subjectId)
      .then((d) => alive && (setData(d), setLoading(false)))
      .catch(() => alive && (setError("Не удалось загрузить журнал"), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [classId, subjectId]);

  const setGrade: JournalCtx["setGrade"] = async (studentId, lessonId, value) => {
    // оптимистично обновляем ячейку, затем фиксируем на сервере
    setData((d) => patchCell(d, studentId, lessonId, value));
    setFlash(`${studentId}|${lessonId}`);
    setTimeout(() => setFlash(null), 700);
    try {
      const row = await api.setGrade({ studentId, lessonId, value });
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.studentId === studentId ? row : r)) } : d));
    } catch {
      ctx.pushToast({ type: "urgent", title: "Не сохранено", msg: "Оценка не записана — проверьте соединение." });
    }
  };

  const latestLessonId = data?.columns.at(-1)?.lessonId ?? null;

  return (
    <Ctx.Provider value={{ data, loading, error, latestLessonId, flash, setGrade }}>
      {children}
    </Ctx.Provider>
  );
}

export function useJournal(): JournalCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useJournal must be used within JournalProvider");
  return c;
}

function patchCell(d: JournalData | null, studentId: string, lessonId: string, value: GradeValue): JournalData | null {
  if (!d) return d;
  const colIx = d.columns.findIndex((c) => c.lessonId === lessonId);
  if (colIx < 0) return d;
  return {
    ...d,
    rows: d.rows.map((r) => {
      if (r.studentId !== studentId) return r;
      const grades = r.grades.slice();
      grades[colIx] = value;
      return { ...r, grades, avg: studentAvg(grades) };
    }),
  };
}
