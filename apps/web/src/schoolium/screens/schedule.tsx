/**
 * Расписание: `S-40` сетка недели и плашка `stale`, `S-41` мастер из четырёх
 * экранов (`M-08`), `S-42` генерация и предпросмотр (`M-09` прогресс, `M-10`
 * отказ).
 *
 * Красная линия 1: сетка — ПРЕДЛОЖЕНИЕ до нажатия «Подтвердить» (AR-18).
 * Автоприменения по таймеру или «раз всё зелёное» здесь нет и быть не может:
 * материализация запускается только из `S-42.btn.confirm`.
 */
import { useEffect, useState } from "react";
import { DAY_MINUTES_CAP, recommendedTerms, slotTimes, type SchedulePreviewDto, type TermDto } from "@edustore/shared";
import { api, SchoolApiError, type LoadEntry } from "../api";
import { useAsync, useIsMobile } from "../hooks";
import { Button, EmptyState, ErrorState, Field, Modal, NumberField, Skeletons, Toast, useToast } from "../ui";
import { useSession } from "../session";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

// ─────────────────────────── S-40 · расписание ───────────────────────────

export function ScheduleScreen() {
  const { can } = useSession();
  const [state, reload] = useAsync(() => api.schedule());
  const [setup, setSetup] = useState(false);
  const [preview, setPreview] = useState<SchedulePreviewDto | null>(null);
  const mayBuild = can("schedule.build");

  if (state.status === "loading") return <Skeletons count={5} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const tpl = state.data;

  return (
    <>
      <div className="sch-page-head">
        <h1>Расписание</h1>
        {mayBuild && tpl ? (
          <Button kind="primary" testId="S-40.btn.setup" onClick={() => setSetup(true)}>
            Настроить расписание
          </Button>
        ) : null}
      </div>

      {/* Плашка «устарело» — одна на экран (`60-design.md`). */}
      {tpl?.status === "stale" ? (
        <div className="sch-banner" data-testid="S-40.banner.stale">
          <span>Расписание устарело. Данные изменились после генерации</span>
          {mayBuild ? (
            <Button
              kind="primary"
              testId="S-40.btn.regenerate"
              onClick={async () => {
                try {
                  setPreview(await api.generate());
                } catch (e) {
                  setPreview(null);
                  alert(e instanceof SchoolApiError ? e.message : "Не удалось");
                }
              }}
            >
              Регенерировать
            </Button>
          ) : null}
        </div>
      ) : null}

      {!tpl ? (
        <EmptyState
          testId="S-40.empty"
          title="Расписание ещё не настроено"
          hint={mayBuild ? "Заполните четверти, нагрузку и параметры дня" : "Расписание появится, когда модератор его настроит"}
          action={
            mayBuild ? (
              <Button kind="primary" testId="S-40.btn.setup" onClick={() => setSetup(true)}>
                Настроить расписание
              </Button>
            ) : undefined
          }
        />
      ) : (
        <WeekGrid preview={tpl} testId="S-40.grid.week" />
      )}

      {setup ? (
        <ScheduleWizard
          onClose={() => setSetup(false)}
          onGenerated={(p) => {
            setSetup(false);
            setPreview(p);
          }}
        />
      ) : null}

      {preview ? (
        <PreviewScreen
          preview={preview}
          onClose={() => {
            setPreview(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

export function WeekGrid({ preview, testId }: { preview: SchedulePreviewDto; testId: string }) {
  const classes = [...new Map(preview.slots.map((s) => [s.classId, s.classLabel])).entries()];
  const maxSlot = Math.max(1, ...preview.slots.map((s) => s.slotNo));
  const days = Math.max(1, ...preview.slots.map((s) => s.dayNo + 1));
  const mobile = useIsMobile();

  /*
   * На мобайле сетка разворачивается (§6): переключатель классов сверху,
   * закреплён столбец времени, дни — колонки. Десктопная ориентация
   * «класс × (день · урок)» на 390px даёт под сотню колонок и остаётся
   * нечитаемой при любом скролле — это не «то же самое, только уже».
   */
  if (mobile) return <WeekGridMobile preview={preview} testId={testId} classes={classes} maxSlot={maxSlot} days={days} />;

  return (
    // Широкое содержимое скроллится ВНУТРИ контейнера: `body` по горизонтали не
    // скроллится никогда (§6).
    <div className="sch-week" data-testid={testId}>
      <table>
        <thead>
          <tr>
            <th>Класс</th>
            {Array.from({ length: days }, (_, d) =>
              Array.from({ length: maxSlot }, (_, s) => (
                <th key={`${d}-${s}`}>
                  {DAY_NAMES[d]} · {s + 1}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {classes.map(([id, label]) => (
            <tr key={id}>
              <th scope="row">{label}</th>
              {Array.from({ length: days }, (_, d) =>
                Array.from({ length: maxSlot }, (_, s) => {
                  const cell = preview.slots.filter((x) => x.classId === id && x.dayNo === d && x.slotNo === s + 1);
                  const paired = cell.length > 1;
                  return (
                    <td
                      key={`${d}-${s}`}
                      className={paired ? "sch-cell--paired" : undefined}
                      data-testid={paired ? "S-40.cell.paired" : undefined}
                    >
                      {cell.map((x, i) => (
                        <span className="sch-slot" key={i}>
                          <span className="sch-slot-subject">
                            {x.subjectName}
                            {x.groupNo ? ` · гр. ${x.groupNo}` : ""}
                          </span>
                          <br />
                          <span className="sch-slot-teacher">{x.teacherName}</span>
                        </span>
                      ))}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `S-40`/`S-42` на мобайле: один класс за раз, строки — уроки дня, колонки —
 * дни недели. Столбец времени закреплён, широкое содержимое скроллится ВНУТРИ
 * контейнера — `body` по горизонтали не скроллится никогда (§6).
 */
function WeekGridMobile({
  preview,
  testId,
  classes,
  maxSlot,
  days,
}: {
  preview: SchedulePreviewDto;
  testId: string;
  classes: [string, string][];
  maxSlot: number;
  days: number;
}) {
  const [classId, setClassId] = useState(classes[0]?.[0] ?? "");
  const [day, setDay] = useState(0);
  const current = classes.some(([id]) => id === classId) ? classId : (classes[0]?.[0] ?? "");

  return (
    <>
      {/* Переключатель классов сверху (§6): на телефоне все классы разом не
          помещаются, и выбор класса — это выбор предмета разговора, а не фильтр. */}
      <div className="sch-field" data-testid="S-40.select.class">
        <span className="sch-field-label">Класс</span>
        <select className="sch-input" value={current} onChange={(e) => setClassId(e.target.value)}>
          {classes.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Лента дней + уроки карточками (правка владельца 2026-08-30, по
          референсам) — тот же паттерн, что дневник `S-90`: таблица
          «день × урок» на 390px оставалась нечитаемой при любом скролле. */}
      <div className="sch-daystrip">
        {Array.from({ length: days }, (_, d) => (
          <button
            key={d}
            className={d === day ? "sch-daychip sch-daychip--active" : "sch-daychip"}
            onClick={() => setDay(d)}
          >
            <small>{DAY_NAMES[d]}</small>
          </button>
        ))}
      </div>

      <div className="sch-stack" data-testid={testId}>
        {Array.from({ length: maxSlot }, (_, s) => {
          const cell = preview.slots.filter((x) => x.classId === current && x.dayNo === day && x.slotNo === s + 1);
          if (cell.length === 0) return null;
          const paired = cell.length > 1;
          const t = slotTimes(preview.grid, s + 1);
          const hasNext = preview.slots.some((x) => x.classId === current && x.dayNo === day && x.slotNo === s + 2);
          return (
            <div key={s} className="sch-stack" style={{ gap: 0 }}>
              <div className="sch-lesson" data-testid={paired ? "S-40.cell.paired" : undefined}>
                <div className="sch-lesson-time">
                  <b>{t.start}</b>
                  <span>{t.end}</span>
                </div>
                <div className="sch-lesson-body">
                  {cell.map((x, i) => (
                    <span className="sch-slot" key={i}>
                      <b>
                        {x.subjectName}
                        {x.groupNo ? ` · гр. ${x.groupNo}` : ""}
                      </b>
                      <span>{x.teacherName}</span>
                    </span>
                  ))}
                </div>
              </div>
              {hasNext ? <div className="sch-break">{`перемена ${t.breakAfterMin} мин`}</div> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─────────────────────────── S-41 · мастер расписания (M-08) ───────────────────────────

const emptyTerms = (): TermDto[] =>
  [1, 2, 3, 4].map((n) => ({ termNo: n as 1 | 2 | 3 | 4, dateFrom: "", dateTo: "" }));

/** Четыре панели по порядку номеров — реестр требует именно четыре (`S-41.panel.term[1..4]`). */
const byTermNo = (rows: TermDto[]): TermDto[] =>
  [1, 2, 3, 4].map(
    (n) => rows.find((t) => t.termNo === n) ?? { termNo: n as 1 | 2 | 3 | 4, dateFrom: "", dateTo: "" },
  );

export function ScheduleWizard({ onClose, onGenerated }: { onClose: () => void; onGenerated: (p: SchedulePreviewDto) => void }) {
  const [step, setStep] = useState(1);
  const [terms, setTerms] = useState<TermDto[]>(emptyTerms);
  const [termsReady, setTermsReady] = useState(false);
  const [load, setLoad] = useState<{ entries: LoadEntry[]; version: number } | null>(null);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [noPriority, setNoPriority] = useState(false);
  const [day, setDay] = useState({ slotsPerDay: "", lessonMin: "45", breakMin: "10", days: 5, bigBreakAfter: 2, bigBreakMin: "20", dayStart: "09:00" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const { toast, showToast } = useToast();

  const [subjects] = useAsync(() => api.subjects());

  /**
   * Панели четвертей приходят заполненными, а не пустыми (`70-screens.md` S-41
   * экран 1): у школы, которая уже задала четверти, — её собственные даты (иначе
   * повторный вход в мастер стирал бы календарь рукой модератора); у новой —
   * рекомендованный график ФООП (базис #5). Пустые панели с нуля — лишний ввод,
   * и реестр их не разрешает.
   */
  useEffect(() => {
    let alive = true;
    api
      .terms()
      .then((rows) => {
        if (!alive) return;
        setTerms(rows.length ? byTermNo(rows) : recommendedTerms(new Date().toISOString().slice(0, 10)));
        setTermsReady(true);
      })
      .catch(() => {
        if (!alive) return;
        setTerms(recommendedTerms(new Date().toISOString().slice(0, 10)));
        setTermsReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = terms.some((t) => t.dateFrom || t.dateTo) || day.slotsPerDay !== "";
  const close = () => (dirty ? setConfirmExit(true) : onClose());

  /** Часы одной привязки: одно место правки — и для поля, и для шаговых кнопок. */
  const setHours = (bindingId: string, hours: number) =>
    setLoad((cur) =>
      cur
        ? { ...cur, entries: cur.entries.map((x) => (x.bindingId === bindingId ? { ...x, hoursPerWeek: Math.max(0, hours) } : x)) }
        : cur,
    );

  const termsValid = terms.every((t) => t.dateFrom && t.dateTo);

  const dayLength = (): number => {
    const slots = Number(day.slotsPerDay) || 0;
    const breaks = Math.max(0, slots - 1);
    const big = day.bigBreakAfter > 0 && day.bigBreakAfter < slots ? 1 : 0;
    return slots * Number(day.lessonMin) + (breaks - big) * Number(day.breakMin) + big * Number(day.bigBreakMin);
  };

  const run = async (fn: () => Promise<unknown>, next: number) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setStep(next);
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const p = await api.generate();
      setGenerating(false);
      onGenerated(p);
    } catch (e) {
      setGenerating(false);
      if (e instanceof SchoolApiError) setRefusal({ code: e.code, message: e.message });
      else setError("Не удалось сгенерировать");
    }
  };

  return (
    <>
      <Modal
        title="Настройка расписания"
        width={720}
        onClose={close}
        testId="M-08"
        mobile="fullscreen"
        onBack={step > 1 ? () => setStep(step - 1) : undefined}
        footer={
          <div className="sch-actions">
            {step > 1 ? (
              <Button kind="ghost" onClick={() => setStep(step - 1)}>
                Назад
              </Button>
            ) : null}
            {step === 1 ? (
              <Button
                kind="primary"
                testId="S-41.btn.next1"
                disabled={!termsValid}
                loading={busy}
                onClick={() =>
                  run(async () => {
                    await api.setTerms(terms);
                    setLoad(await api.load());
                  }, 2)
                }
              >
                Далее
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                kind="primary"
                testId="S-41.btn.next2"
                disabled={!load || load.entries.some((e) => !e.hoursPerWeek)}
                loading={busy}
                onClick={() =>
                  run(
                    () =>
                      api.setLoad({
                        entries: load!.entries.map((e) => ({ bindingId: e.bindingId, hoursPerWeek: e.hoursPerWeek })),
                        version: load!.version,
                      }),
                    3,
                  )
                }
              >
                Далее
              </Button>
            ) : null}
            {step === 3 ? (
              <Button
                kind="primary"
                testId="S-41.btn.next3"
                disabled={priorities.length === 0 && !noPriority}
                loading={busy}
                onClick={() => run(() => api.setPriorities({ subjectIds: priorities, explicitNone: noPriority }), 4)}
              >
                Далее
              </Button>
            ) : null}
            {step === 4 ? (
              // Единственная РОЗОВАЯ кнопка потока — ключевое действие шага (AR-80).
              <Button
                kind="accent"
                testId="S-41.btn.generate"
                disabled={!day.slotsPerDay}
                loading={busy || generating}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const fresh = await api.load();
                    await api.setDayParams({
                      slotsPerDay: Number(day.slotsPerDay),
                      lessonMin: Number(day.lessonMin),
                      breakMin: Number(day.breakMin),
                      days: day.days as 5 | 6,
                      bigBreakAfter: day.bigBreakAfter,
                      bigBreakMin: Number(day.bigBreakMin),
                      dayStartMin: Number(day.dayStart.slice(0, 2)) * 60 + Number(day.dayStart.slice(3, 5)),
                      version: fresh.version,
                    });
                    setBusy(false);
                    await generate();
                  } catch (e) {
                    setBusy(false);
                    setError(e instanceof SchoolApiError ? e.message : "Не получилось");
                  }
                }}
              >
                Сгенерировать
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="sch-steps">
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className="sch-step-dot" data-done={n <= step} />
          ))}
        </div>

        {/* Экран 1 — четверти. Даты уходят В КАЛЕНДАРЬ: модалка их не хранит (AR-68). */}
        {step === 1 && !termsReady ? <Skeletons count={4} kind="row" /> : null}
        {step === 1 && termsReady ? (
          <div className="sch-terms">
            {terms.map((t, i) => (
              <div className="sch-term-panel" key={t.termNo} data-testid={`S-41.panel.term${t.termNo}`} data-valid={Boolean(t.dateFrom && t.dateTo)}>
                <div className="sch-row sch-row--between">
                  <strong>{t.termNo} четверть</strong>
                  {t.dateFrom && t.dateTo ? (
                    <span className="sch-success-text" data-testid="S-41.term.check">
                      ✓
                    </span>
                  ) : null}
                </div>
                <Field
                  label="Начало"
                  type="date"
                  value={t.dateFrom}
                  onChange={(e) => {
                    const next = [...terms];
                    next[i] = { ...t, dateFrom: e.target.value };
                    setTerms(next);
                  }}
                />
                <Field
                  label="Конец"
                  type="date"
                  value={t.dateTo}
                  onChange={(e) => {
                    const next = [...terms];
                    next[i] = { ...t, dateTo: e.target.value };
                    setTerms(next);
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}

        {/* Экран 2 — нагрузка: аккордеон по педагогу, окошки на каждую его пару. */}
        {step === 2 && load ? (
          <div>
            {[...new Map(load.entries.map((e) => [e.teacherId, e.teacherName])).entries()].map(([tid, tname]) => (
              <details className="sch-accordion" key={tid} data-testid="S-41.accordion.teacher" open>
                <summary>{tname}</summary>
                <div>
                  {load.entries
                    .filter((e) => e.teacherId === tid)
                    .map((e) => (
                      <div className="sch-hours-row" key={e.bindingId}>
                        <label htmlFor={`h-${e.bindingId}`}>
                          {e.subjectName} · {e.classLabel} класс
                          {e.scope === "group" ? `, группа ${e.groupNos.join(", ")}` : ""}
                        </label>
                        {/* Шаговые кнопки 44×44 рядом с полем часов (§7) —
                            на мобайле; на десктопе CSS их не рендерит. */}
                        <div className="sch-stepper">
                          <Button
                            kind="secondary"
                            className="sch-btn--stepper"
                            aria-label={`${e.subjectName}: меньше часов`}
                            disabled={e.hoursPerWeek <= 0}
                            onClick={() => setHours(e.bindingId, e.hoursPerWeek - 1)}
                          >
                            −
                          </Button>
                          <input
                            id={`h-${e.bindingId}`}
                            className="sch-input"
                            data-testid="S-41.input.hours"
                            data-binding-id={e.bindingId}
                            inputMode="numeric"
                            value={e.hoursPerWeek || ""}
                            onChange={(ev) => setHours(e.bindingId, Number(ev.target.value) || 0)}
                          />
                          <Button
                            kind="secondary"
                            className="sch-btn--stepper"
                            aria-label={`${e.subjectName}: больше часов`}
                            onClick={() => setHours(e.bindingId, e.hoursPerWeek + 1)}
                          >
                            +
                          </Button>
                        </div>
                      </div>
                    ))}
                  <p className="sch-muted" data-testid="S-41.summary.class">
                    {tname}: {load.entries.filter((e) => e.teacherId === tid).reduce((a, e) => a + e.hoursPerWeek, 0)} часов
                  </p>
                </div>
              </details>
            ))}
          </div>
        ) : null}

        {/* Экран 3 — приоритеты + ЯВНЫЙ отказ (AR-77). */}
        {step === 3 ? (
          <div className="sch-stack">
            <div className="sch-chips" data-testid="S-41.chips.priority">
              {subjects.status === "ready"
                ? subjects.data.map((s) => (
                    <Button
                      key={s.id}
                      kind="chip"
                      aria-pressed={priorities.includes(s.id)}
                      onClick={() => {
                        setNoPriority(false);
                        setPriorities((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]));
                      }}
                    >
                      {s.name} · {s.classLabel}
                    </Button>
                  ))
                : null}
            </div>
            <Button
              kind="off"
              testId="S-41.btn.noPriority"
              aria-pressed={noPriority}
              onClick={() => {
                setNoPriority(true);
                setPriorities([]);
              }}
            >
              ⌀ Без приоритетов
            </Button>
          </div>
        ) : null}

        {/* Экран 4 — параметры дня. «Уроков в день» — верхняя граница (AR-114). */}
        {step === 4 ? (
          <div className="sch-stack">
            <NumberField
              label="Уроков в день"
              hint="верхняя граница: каждый класс получит не больше потолка своей параллели"
              testId="S-41.input.slotsPerDay"
              min={1}
              max={8}
              value={day.slotsPerDay}
              onValue={(v) => setDay({ ...day, slotsPerDay: v })}
            />
            <NumberField
              label="Длина урока, минут"
              testId="S-41.input.lessonMin"
              min={30}
              max={45}
              value={day.lessonMin}
              onValue={(v) => setDay({ ...day, lessonMin: v })}
              error={Number(day.lessonMin) > 45 ? "Не более 45 минут — СанПиН 1.2.3685-21" : null}
            />
            <NumberField
              label="Длина перемены, минут"
              testId="S-41.input.breakMin"
              min={10}
              max={30}
              value={day.breakMin}
              onValue={(v) => setDay({ ...day, breakMin: v })}
              error={Number(day.breakMin) < 10 ? "Не менее 10 минут — СанПиН 1.2.3685-21" : null}
            />
            <div className="sch-field">
              <span className="sch-field-label">Начало первого урока</span>
              <input
                className="sch-input"
                type="time"
                data-testid="S-41.input.dayStart"
                value={day.dayStart}
                onChange={(e) => setDay({ ...day, dayStart: e.target.value || "09:00" })}
              />
            </div>
            <div className="sch-field">
              <span className="sch-field-label">Учебных дней в неделю</span>
              <div className="sch-chips" data-testid="S-41.input.days">
                {[5, 6].map((d) => (
                  <Button key={d} kind="chip" aria-pressed={day.days === d} onClick={() => setDay({ ...day, days: d })}>
                    {d}
                  </Button>
                ))}
              </div>
            </div>
            <div className="sch-field">
              <span className="sch-field-label">Большая перемена после урока</span>
              <select
                className="sch-input"
                data-testid="S-41.select.bigBreakAfter"
                value={day.bigBreakAfter}
                onChange={(e) => setDay({ ...day, bigBreakAfter: Number(e.target.value) })}
              >
                <option value={2}>после 2-го</option>
                <option value={3}>после 3-го</option>
              </select>
            </div>
            <NumberField
              label="Длительность большой перемены, минут"
              testId="S-41.input.bigBreakMin"
              min={20}
              max={30}
              value={day.bigBreakMin}
              onValue={(v) => setDay({ ...day, bigBreakMin: v })}
              error={
                Number(day.bigBreakMin) < 20 || Number(day.bigBreakMin) > 30
                  ? "От 20 до 30 минут — СанПиН 1.2.3685-21"
                  : null
              }
            />
            {/* Потребитель четырёх временных параметров: без него они мёртвый ввод (AR-103). */}
            <p className="sch-muted" data-testid="S-41.calc.dayLength">
              Учебный день: {dayLength()} минут из {DAY_MINUTES_CAP}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="sch-danger-text" role="alert" style={{ marginTop: "var(--sp-12)" }}>
            {error}
          </p>
        ) : null}
      </Modal>

      {/*
        M-09 — полноэкранный прогресс генерации с кнопкой «Отменить» (AR-107).
        Идентификатор `M-09` принадлежит ЕМУ, а не предпросмотру: реестр §3
        называет `M-09` прогрессом генерации. До этапа 3 имя стояло на модалке
        предпросмотра, а прогресс жил без имени модалки вовсе — перечисление
        «пятнадцать модалок открыты» доказывало бы не тот предмет.
      */}
      {generating ? (
        <div className="sch-fullscreen" data-testid="M-09">
          <div data-testid="S-42.progress" className="sch-stack" style={{ alignItems: "center" }}>
          <div className="sch-logo" style={{ fontSize: "var(--fs-h1)" }}>
            Schoolium
          </div>
          <p>Собираем сетку…</p>
          <Button
            kind="secondary"
            testId="S-42.btn.cancelGen"
            onClick={async () => {
              await api.cancelGeneration().catch(() => undefined);
              setGenerating(false);
              showToast("Генерация отменена — школа осталась на шаге параметров дня");
            }}
          >
            Отменить
          </Button>
          </div>
        </div>
      ) : null}

      {/* M-10 — отказ генератора: код, причина с цифрами, кнопка «К шагу N». */}
      {refusal ? (
        <Modal
          title="Сетка не собралась"
          width={520}
          onClose={() => setRefusal(null)}
          testId="S-42.refusal"
          mobile="fullscreen"
          footer={
            <div className="sch-actions">
              <Button
                kind="primary"
                onClick={() => {
                  const back = STEP_BY_CODE[refusal.code] ?? 4;
                  setRefusal(null);
                  setStep(back);
                }}
              >
                К шагу {STEP_BY_CODE[refusal.code] ?? 4}
              </Button>
            </div>
          }
        >
          <p>
            <strong>{refusal.code}</strong>
          </p>
          <p>{refusal.message}</p>
        </Modal>
      ) : null}

      {confirmExit ? (
        <Modal
          title="Закрыть без сохранения?"
          width={400}
          onClose={() => setConfirmExit(false)}
          testId="M-14"
        mobile="sheet"
          level={2}
          footer={
            <div className="sch-actions">
              <Button kind="ghost" onClick={() => setConfirmExit(false)}>
                Продолжить ввод
              </Button>
              <Button kind="danger" onClick={onClose}>
                Закрыть без сохранения
              </Button>
            </div>
          }
        >
          <p>Введённые данные не сохранятся.</p>
        </Modal>
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

/** Отказ ведёт кнопкой на КОНКРЕТНЫЙ шаг мастера (`S-42.refusal`). */
const STEP_BY_CODE: Record<string, number> = {
  TERM_OVERLAP: 1,
  TERM_REVERSED: 1,
  LOAD_EXCEEDS_SANPIN: 2,
  GROUP_HOURS_UNEQUAL: 2,
  LOAD_EXCEEDS_GRID: 4,
  TEACHER_OVERBOOKED: 4,
  DAY_EXCEEDS_SANPIN: 4,
  DAY_TOO_LONG: 4,
  NO_SOLUTION: 3,
};

// ─────────────────────────── S-42 · предпросмотр ───────────────────────────

export function PreviewScreen({ preview, onClose }: { preview: SchedulePreviewDto; onClose: () => void }) {
  const [cur, setCur] = useState(preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  return (
    <>
      <Modal
        title="Предпросмотр расписания"
        width={960}
        onClose={onClose}
        testId="S-42"
        mobile="fullscreen"
        footer={
          <div className="sch-actions">
            <Button
              kind="secondary"
              testId="S-42.btn.regenerate"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setCur(await api.generate());
                } catch (e) {
                  setError(e instanceof SchoolApiError ? e.message : "Не получилось");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Регенерировать
            </Button>
            {/* Единственный путь к материализации (AR-18, красная линия 1). */}
            <Button
              kind="primary"
              testId="S-42.btn.confirm"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const r = await api.confirm({ templateId: cur.templateId, version: cur.version });
                  showToast(`Материализовано уроков: ${r.materialized}`);
                  onClose();
                } catch (e) {
                  setError(e instanceof SchoolApiError ? e.message : "Не получилось");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Подтвердить
            </Button>
          </div>
        }
      >
        {/* Мягкое предупреждение приоритетов — не блокирует (ограничение 6). */}
        {cur.priorityWarnings.length > 0 ? (
          <div className="sch-banner" data-testid="S-42.warn.priority">
            <span>{cur.priorityWarnings.join("; ")}</span>
          </div>
        ) : null}
        {/* Повторное подтверждение: сколько уроков с отметками уйдёт «вне расписания». */}
        {cur.willDetach > 0 ? (
          <div className="sch-banner" data-testid="S-42.warn.detach">
            <span>
              {cur.willDetach} уроков с отметками останутся в журнале с пометкой «вне расписания» — отметки не удаляются
            </span>
          </div>
        ) : null}
        <WeekGrid preview={cur} testId="S-42.grid.preview" />
        {error ? (
          <p className="sch-danger-text" role="alert" style={{ marginTop: "var(--sp-12)" }}>
            {error}
          </p>
        ) : null}
      </Modal>
      {toast ? <Toast text={toast} /> : null}
    </>
  );
}
