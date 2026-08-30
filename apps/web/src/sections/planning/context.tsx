import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { LessonDetail, LessonStation } from "@edustore/shared";
import { api } from "@/lib/api";
import type { SectionContext } from "@/sections/types";

interface PlanningCtx {
  lessons: LessonStation[];
  activeIndex: number;
  setActiveIndex: (updater: (i: number) => number) => void;
  detail: LessonDetail | null;
  loading: boolean;
}

const Ctx = createContext<PlanningCtx | null>(null);

export function PlanningProvider({ ctx, children }: { ctx: SectionContext; children: ReactNode }) {
  const [lessons, setLessons] = useState<LessonStation[]>([]);
  const [activeIndex, setIndex] = useState(0);
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const classId = ctx.assignment?.classId;
  const subjectId = ctx.assignment?.subjectId;

  // загрузка ветки уроков (станций метро)
  useEffect(() => {
    if (!classId) return;
    let alive = true;
    setLoading(true);
    api
      .getLessons(classId, subjectId)
      .then((ls) => {
        if (!alive) return;
        setLessons(ls);
        setIndex(Math.min(4, Math.max(0, ls.length - 1))); // показать содержательный урок
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [classId, subjectId]);

  // загрузка деталей активного урока
  useEffect(() => {
    const l = lessons[activeIndex];
    if (!l) return;
    let alive = true;
    api.getLesson(l.id).then((d) => alive && setDetail(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [lessons, activeIndex]);

  const setActiveIndex: PlanningCtx["setActiveIndex"] = (updater) =>
    setIndex((i) => Math.max(0, Math.min(lessons.length - 1, updater(i))));

  return (
    <Ctx.Provider value={{ lessons, activeIndex, setActiveIndex, detail, loading }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePlanning(): PlanningCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlanning must be used within PlanningProvider");
  return c;
}
