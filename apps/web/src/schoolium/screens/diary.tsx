/**
 * `S-90` дневник и `S-91` успеваемость (AR-158, AR-159) — кабинет ученика и
 * родителя. Чтение без единой мутации; объём решает сервер по идентичности
 * (свои дети / сам ученик), экран ничего не фильтрует сам.
 *
 * Раскладка — школьный дневник: дни недели → уроки → предмет, тема, отметка.
 * Колонки ДЗ нет вовсе — появится инкрементом №2, пустая колонка не рисуется.
 */
import { useEffect, useState } from "react";
import { type DiaryChildDto, type DiaryWeekDto, type SubjectAverageDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useIsMobile } from "../hooks";
import { Badge, Button, EmptyState, ErrorState, Skeletons } from "../ui";
import { navigate } from "../router";
import {
  addDays,
  buildDayRows,
  DAY_NAMES,
  DayLessonList,
  Days33,
  DayStrip,
  dayMonth,
  mondayOf,
  weekRange,
  WeekStrip,
  type DayCell,
} from "../schedule-view";

const DAY_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

export function DiaryScreen() {
  const [children, setChildren] = useState<DiaryChildDto[] | null>(null);
  const [child, setChild] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<DiaryWeekDto | null>(null);
  const [averages, setAverages] = useState<SubjectAverageDto[] | null>(null);
  const [tab, setTab] = useState<"week" | "averages">("week");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .diaryChildren()
      .then((c) => {
        setChildren(c);
        if (c.length > 0) setChild(c[0].studentId);
      })
      .catch((e) => setError(e instanceof SchoolApiError ? e.message : "Не удалось открыть дневник"));
  }, []);

  useEffect(() => {
    if (!child) return;
    setData(null);
    api
      .diaryWeek(child, week)
      .then(setData)
      .catch((e) => setError(e instanceof SchoolApiError ? e.message : "Не удалось открыть дневник"));
    api
      .diaryAverages(child)
      .then(setAverages)
      .catch(() => undefined);
  }, [child, week]);

  return (
    // 1080, не 720: десктопная неделя 3+3 (AR-175) в двух колонках карточек
    <div className="sch" style={{ maxWidth: 1080, margin: "0 auto", padding: "var(--sp-16)" }}>
      <div className="sch-page-head">
        <h1 data-testid="S-90.header">Дневник</h1>
        <Button
          kind="ghost"
          testId="S-90.btn.logout"
          onClick={async () => {
            await api.logout().catch(() => undefined);
            navigate("/");
            window.location.reload();
          }}
        >
          Выйти
        </Button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : children === null ? (
        <Skeletons count={4} />
      ) : children.length === 0 ? (
        <EmptyState
          testId="S-90.empty"
          title="Дневников пока нет"
          hint="Записи появятся, когда модератор школы привяжет к вашей учётке ученика"
        />
      ) : (
        <>
          {/* Плитки детей — главная родителя; у ученика ровно одна и не рисуется. */}
          {children.length > 1 ? (
            <div className="sch-chips" data-testid="S-90.children" style={{ marginBottom: "var(--sp-16)" }}>
              {children.map((c) => (
                <button
                  key={c.studentId}
                  className={c.studentId === child ? "sch-chip sch-chip--active" : "sch-chip"}
                  onClick={() => {
                    setChild(c.studentId);
                    setWeek(null);
                  }}
                >
                  {c.name} · {c.classLabel}
                </button>
              ))}
            </div>
          ) : null}

          <div className="sch-chips" style={{ marginBottom: "var(--sp-16)" }}>
            <button className={tab === "week" ? "sch-chip sch-chip--active" : "sch-chip"} data-testid="S-90.tab.week" onClick={() => setTab("week")}>
              Неделя
            </button>
            <button
              className={tab === "averages" ? "sch-chip sch-chip--active" : "sch-chip"}
              data-testid="S-91.tab.averages"
              onClick={() => setTab("averages")}
            >
              Успеваемость
            </button>
          </div>

          {tab === "week" ? (
            data === null ? (
              <Skeletons count={5} />
            ) : (
              <WeekView data={data} onWeek={setWeek} />
            )
          ) : averages === null ? (
            <Skeletons count={5} />
          ) : (
            <AveragesView rows={averages} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Неделя дневника (AR-175, УТЦ v1.4 фаза II) — тем же общим модулем, что
 * расписание `S-40`: строка «N. Предмет» несёт отметку СРАЗУ после названия,
 * времена — из скелета дня (AR-171), без скелета — `slotTimes`. Мобайл — лента
 * дней с датой только под открытым; десктоп — лента недель и неделя 3+3.
 */
function WeekView({ data, onWeek }: { data: DiaryWeekDto; onWeek: (m: string) => void }) {
  const mobile = useIsMobile();
  const idx = data.weeks.findIndex((w) => w.monday === data.monday);
  const prev = idx > 0 ? data.weeks[idx - 1] : null;
  const next = idx >= 0 && idx < data.weeks.length - 1 ? data.weeks[idx + 1] : null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const [selected, setSelected] = useState<number | null>(null);

  const cellsFor = (dayNo: number): Map<number, DayCell[]> => {
    const date = addDays(data.monday, dayNo);
    const map = new Map<number, DayCell[]>();
    for (const l of data.days.find((d) => d.date === date)?.lessons ?? []) {
      const cells = map.get(l.slotNo) ?? [];
      cells.push({ key: l.lessonId, title: l.subjectName, sub: l.topic, mark: l.mark });
      map.set(l.slotNo, cells);
    }
    return map;
  };
  const rowsFor = (dayNo: number) =>
    buildDayRows({ skeleton: data.skeleton, grid: data.grid, dayNo, cellsByLesson: cellsFor(dayNo) });

  const firstBusy = data.days[0]?.date ? (new Date(`${data.days[0].date}T00:00:00.000Z`).getUTCDay() + 6) % 7 : 0;
  const day =
    selected ?? (mondayOf(todayIso) === data.monday ? (new Date(`${todayIso}T00:00:00.000Z`).getUTCDay() + 6) % 7 : firstBusy);

  return (
    <div className="sch-stack" data-testid="S-90.week">
      {data.days.length === 0 ? (
        <EmptyState testId="S-90.emptyWeek" title="Уроков на этой неделе нет" />
      ) : mobile ? (
        <>
          <div className="sch-weekbar">
            <button
              className="sch-weeknav"
              data-testid="S-90.btn.prevWeek"
              disabled={!prev}
              aria-label="Предыдущая неделя"
              onClick={() => prev && onWeek(prev.monday)}
            >
              ‹
            </button>
            <span className="sch-weekrange" data-testid="S-90.weekRange">
              {weekRange(data.monday, addDays(data.monday, 5))}
            </span>
            <button
              className="sch-weeknav"
              data-testid="S-90.btn.nextWeek"
              disabled={!next}
              aria-label="Следующая неделя"
              onClick={() => next && onWeek(next.monday)}
            >
              ›
            </button>
          </div>

          <DayStrip
            testId="S-90.daystrip"
            days={[0, 1, 2, 3, 4, 5, 6].map((d) => ({
              dayNo: d,
              label: DAY_NAMES[d],
              date: addDays(data.monday, d),
              muted: rowsFor(d).length === 0,
            }))}
            open={day}
            onOpen={setSelected}
          />

          <section aria-label={`${DAY_FULL[day]} ${dayMonth(addDays(data.monday, day))}`}>
            {/* key: смена дня перезапускает раскрытие сверху вниз (`sch-unfold`) */}
            <DayLessonList key={day} rows={rowsFor(day)} testId="S-90.day" />
          </section>
        </>
      ) : (
        <>
          {/* десктоп: недели журнала лентой (`S-90.weekRange` живёт в ленте недель) */}
          <WeekStrip
            testId="S-90.weeks"
            weeks={data.weeks.map((w) => ({
              monday: w.monday,
              label: weekRange(w.monday, addDays(w.monday, 5)),
              muted: !w.hasLessons,
            }))}
            open={data.monday}
            onOpen={onWeek}
          />
          <Days33
            testId="S-90.day"
            dayNos={[0, 1, 2, 3, 4, 5]}
            header={(d) => `${DAY_NAMES[d]} · ${dayMonth(addDays(data.monday, d))}`}
            render={(d) => <DayLessonList rows={rowsFor(d)} />}
          />
        </>
      )}
    </div>
  );
}

/** `S-91` (AR-159): средние по предметам; рейтинг-ранжирование — отдельная спека. */
function AveragesView({ rows }: { rows: SubjectAverageDto[] }) {
  if (rows.length === 0) {
    return <EmptyState testId="S-91.empty" title="Предметов пока нет" hint="Успеваемость появится вместе с расписанием" />;
  }
  return (
    <div className="sch-card" data-testid="S-91.table">
      <table className="sch-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Предмет</th>
            <th style={{ textAlign: "right" }}>Средний балл</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.subjectId}>
              <td>{r.subjectName}</td>
              <td style={{ textAlign: "right" }}>
                {/* числовых отметок нет — «—», а не ноль (AR-79, свойство P7) */}
                {r.average === null ? <span className="sch-muted">—</span> : <Badge>{r.average.toFixed(2)}</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
