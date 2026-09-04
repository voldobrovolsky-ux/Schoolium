/**
 * Расписание: `S-40` вид недели (ленты, 3+3), `S-41` НАСТРОЙКА — одна
 * полноэкранная модалка `M-08` со ВСЕМИ параметрами сразу (решение владельца
 * 2026-08-30, УТЦ v1.4 фаза IV): четверти, нагрузка, приоритеты, параметры
 * дня, скелет дня с маркером сетки. `S-42` — результат генерации ДВУМЯ
 * полноэкранными вкладками «Расписание | Настройка»; `S-43` — ручная
 * перестановка слотов класса в черновике.
 *
 * Красная линия 1: сетка — ПРЕДЛОЖЕНИЕ до нажатия «Подтвердить» (AR-18).
 * Автоприменения нет и быть не может: материализация запускается только из
 * `S-42.btn.confirm`; ручная правка `S-43` тоже живёт ДО подтверждения.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LESSON_CANCEL_REASON_LABELS,
  LESSON_CANCEL_REASONS,
  recommendedTerms,
  SCHOOL_YEAR_WEEKS,
  skeletonLessonTimes,
  slotTimes,
  weeklyOfYear,
  type ClassDto,
  type DatedLessonDto,
  type GridKind,
  type LessonCancelReason,
  type SchedulePreviewDto,
  type SkeletonKind,
  type SkeletonPositionDto,
  type StaffCardDto,
  type SubstitutionResultDto,
  type TeacherPreferenceDto,
  type TermDto,
} from "@edustore/shared";
import { api, SchoolApiError, type LoadEntry } from "../api";
import { useAsync, useIsMobile } from "../hooks";
import { Icon } from "../icons";
import { Button, EmptyState, ErrorState, Field, Modal, NumberField, Skeletons, Toast, useToast } from "../ui";
import { useMe, useSession } from "../session";
import {
  addDays,
  buildDayRows,
  calendarDays,
  DAY_NAMES,
  DayLessonList,
  DayPicker,
  Days33,
  dayMonth,
  dayNoOf,
  inTerms,
  mondayOf,
  teacherInitials,
  teacherShort,
  weekRange,
  WeekStrip,
  type DayCell,
  type DayCellStatus,
} from "../schedule-view";
// Стили пакета 04.09 (маркеры, действия строки, обед по классам, M-30/M-31).
import "./schedule.css";

// ─────────────────────────── S-40 · расписание ───────────────────────────

export function ScheduleScreen() {
  const { can } = useSession();
  const [state, reload] = useAsync(() => api.schedule());
  const [setup, setSetup] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [preview, setPreview] = useState<SchedulePreviewDto | null>(null);
  // Педагог (AR-206): «Мои предпочтения» — до сетки в шапке, при сетке в панели фильтров.
  const [prefsOpen, setPrefsOpen] = useState(false);
  // Оверлей отмен изменился (AR-207) — плашка «Уроков без замены» пересчитывается.
  const [overlayNonce, setOverlayNonce] = useState(0);
  const [focus, setFocus] = useState<LessonFocus | null>(null);
  const { toast, showToast } = useToast();
  const mayBuild = can("schedule.build");
  // Нормы часов — только у держателя `schedule.load.write`: завуч и
  // администратор; модератор кнопки не видит (AR-196). У завуча это
  // единственная кнопка панели (AR-174) — потому primary.
  const mayLoad = can("schedule.load.write");
  const mayLoadOnly = !mayBuild && mayLoad;
  const mayPrefs = can("schedule.preference.self");
  // Плашка «Уроков без замены: N» — строителю и завучу (AR-207).
  const mayOversee = mayBuild || can("school.oversee");

  if (state.status === "loading") return <Skeletons count={5} kind="row" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const tpl = state.data;
  // Учебных дней школы — из шаблона; до первой сетки чипов M-30 шесть (ПН…СБ).
  const schoolDays = tpl ? Math.max(5, ...tpl.slots.map((s) => s.dayNo + 1)) : 6;

  return (
    <>
      <div className="sch-page-head">
        <h1>Расписание</h1>
        {mayBuild && tpl ? (
          <Button kind="primary" testId="S-40.btn.setup" onClick={() => setSetup(true)}>
            Настроить расписание
          </Button>
        ) : null}
        {/* Нормы часов (AR-174, AR-180, AR-196): экран годовых норм — завуча и
            администратора; модератору не показывается. */}
        {mayLoad ? (
          <Button kind={mayLoadOnly ? "primary" : "secondary"} testId="S-40.btn.load" onClick={() => setLoadOpen(true)}>
            Нормы часов
          </Button>
        ) : null}
        {/* Сетки ещё нет — рабочие дни педагога нужны генератору ДО неё (AR-206). */}
        {mayPrefs && !tpl ? (
          <Button kind="secondary" testId="S-40.btn.preferences" onClick={() => setPrefsOpen(true)}>
            Мои предпочтения
          </Button>
        ) : null}
      </div>

      {tpl && mayOversee ? (
        <NoSubstituteBanner
          nonce={overlayNonce}
          onShow={(l) => setFocus({ date: l.date, classId: l.classId, lessonId: l.lessonId, seq: Date.now() })}
        />
      ) : null}

      {/* Черновик, оставшийся без подтверждения (сценарий «закрыл вкладки»):
          ученики его не видят, и молчать об этом нельзя — AR-18 вслух. */}
      {tpl?.status === "draft" ? (
        <div className="sch-banner" data-testid="S-40.banner.draft">
          <span>Сетка собрана, но не подтверждена — ученики её не видят</span>
          {mayBuild ? (
            <Button kind="primary" testId="S-40.btn.resumeDraft" onClick={() => setPreview(tpl)}>
              Продолжить
            </Button>
          ) : null}
        </div>
      ) : null}

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
          icon="calendar"
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
        <ScheduleWeekView
          preview={tpl}
          onPreferences={mayPrefs ? () => setPrefsOpen(true) : undefined}
          onChanged={() => setOverlayNonce((n) => n + 1)}
          focus={focus}
        />
      )}

      {prefsOpen ? (
        <PreferencesModal
          days={schoolDays}
          onClose={() => setPrefsOpen(false)}
          onSaved={() => {
            setPrefsOpen(false);
            showToast("Предпочтения сохранены — сетку пересоберёт модератор");
          }}
        />
      ) : null}

      {setup ? (
        <ScheduleSetup
          preset={tpl}
          onClose={() => setSetup(false)}
          onGenerated={(p) => {
            setSetup(false);
            setPreview(p);
          }}
        />
      ) : null}

      {loadOpen ? <LoadHoursModal onClose={() => { setLoadOpen(false); reload(); }} /> : null}

      {preview ? (
        <PreviewScreen
          preview={preview}
          onClose={() => {
            setPreview(null);
            reload();
          }}
        />
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

/** Адрес строки урока для прокрутки из плашки «Уроков без замены» (AR-207). */
interface LessonFocus {
  date: string;
  classId: string;
  lessonId: string;
  /** Метка нажатия: тот же урок дважды — снова прокрутка. */
  seq: number;
}

/**
 * `S-40.banner.noSubstitute` (AR-207): отменённые уроки без заместителя на
 * горизонте материализации — ближайшие три недели (AR-101). Строителю и
 * завучу; нажатие ведёт к первой такой строке.
 */
function NoSubstituteBanner({ nonce, onShow }: { nonce: number; onShow: (l: DatedLessonDto) => void }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [state] = useAsync(() => api.datedLessons({ from: todayIso, to: addDays(todayIso, 20) }), [nonce]);
  if (state.status !== "ready") return null;
  const open = state.data
    .filter((l) => !l.detached && l.substitution?.status === "no_substitute")
    .sort((a, b) => a.date.localeCompare(b.date) || a.slotNo - b.slotNo);
  if (!open.length) return null;
  return (
    <div className="sch-banner" data-testid="S-40.banner.noSubstitute">
      <span>Уроков без замены: {open.length}</span>
      <Button kind="secondary" onClick={() => onShow(open[0])}>
        Показать
      </Button>
    </div>
  );
}

/** Ключ датированного урока — тот же, что ключ идемпотентности материализации (AR-101). */
const lessonKey = (date: string, slotNo: number, classId: string, groupNo: number | null | undefined): string =>
  `${date}|${slotNo}|${classId}|${groupNo ?? 0}`;

/** «9:05» → минуты от полуночи (времена фолбэка `slotTimes` — строки). */
const hm = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * `S-40` подтверждённая неделя (AR-175, УТЦ v1.4 фазы II-III): неделя читается
 * ЗА КЛАСС или ЗА ПРЕПОДАВАТЕЛЯ, один за раз в обеих раскладках. Мобайл —
 * лента дней ПН…ВС, дата ТОЛЬКО под открытым днём; десктоп — лента недель
 * учебного года и вся неделя 3+3 (ПН/ВТ/СР | ЧТ/ПТ/СБ). Времена строк — из
 * скелета дня (AR-171); школа без скелета живёт на `slotTimes`. Табличная
 * сетка «класс × (день · урок)» осталась предпросмотру `S-42`: там модератор
 * проверяет ВСЮ школу разом, здесь человек читает СВОЮ неделю.
 */
function ScheduleWeekView({
  preview,
  onPreferences,
  onChanged,
  focus,
}: {
  preview: SchedulePreviewDto;
  /** «Мои предпочтения» (AR-206): кнопка есть, только когда экран дал обработчик — право у него. */
  onPreferences?: () => void;
  /** Отмена, отзыв или замена изменили датированный оверлей (AR-207). */
  onChanged?: () => void;
  /** Показать строку урока — из плашки «Уроков без замены». */
  focus?: LessonFocus | null;
}) {
  const mobile = useIsMobile();
  const me = useMe();
  const { can } = useSession();
  const mayBuild = can("schedule.build");
  const mayCancelSelf = can("lesson.cancel.self");
  // Причина отмены словами — только штатным ролям с правом (AR-207); остальным «Отменён».
  const seesReason = mayBuild || can("staff.manage") || can("school.oversee");
  const isTeacher = me.roles.includes("teacher");
  const { toast, showToast } = useToast();

  const classes = [...new Map(preview.slots.map((s) => [s.classId, s.classLabel])).entries()];
  const [classId, setClassId] = useState(classes[0]?.[0] ?? "");
  const current = classes.some(([id]) => id === classId) ? classId : (classes[0]?.[0] ?? "");

  // Фильтр панели (фаза III): неделя читается ЗА КЛАСС или ЗА ПРЕПОДАВАТЕЛЯ.
  // У педагога по умолчанию — «Преподаватель», и это он сам (AR-206).
  const [view, setView] = useState<"class" | "teacher">(isTeacher ? "teacher" : "class");
  const teachers = [...new Map(preview.slots.map((s) => [s.teacherId, s.teacherName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], "ru"),
  );
  const [teacherId, setTeacherId] = useState(isTeacher ? me.userId : "");
  const curTeacher = teachers.some(([id]) => id === teacherId) ? teacherId : (teachers[0]?.[0] ?? "");

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [terms] = useAsync(() => api.terms());
  const weeks = useMemo(
    () => termWeeks(terms.status === "ready" ? terms.data : [], todayIso),
    [terms, todayIso],
  );
  const [week, setWeek] = useState<string | null>(null);
  const openWeek =
    week && weeks.some((w) => w.monday === week)
      ? week
      : (weeks.find((w) => w.monday === mondayOf(todayIso)) ?? weeks.find((w) => !w.muted) ?? weeks[0]).monday;
  const termList = terms.status === "ready" ? terms.data : [];

  // Мобильный пикер живёт ДАТАМИ сквозной ленты календаря, а не днями недели:
  // дефолт — сегодняшний учебный день либо ближайший следующий (31 августа до
  // начала четверти в ленте отсутствует и открыться не может).
  const days = useMemo(() => calendarDays(termList, todayIso), [terms, todayIso]);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const openDay =
    openDate && days.some((d) => d.date === openDate)
      ? openDate
      : (days.find((d) => d.date >= todayIso) ?? days[days.length - 1]).date;

  // ── Датированный оверлей недели (AR-207): отмены и замены поверх шаблона. ──
  // За класс — только его уроки; за преподавателя — вся неделя школы: урок,
  // доставшийся ему заменой, в шаблоне не стоит, и без общего чтения его не найти.
  const weekMonday = mobile ? mondayOf(openDay) : openWeek;
  const [overlayNonce, setOverlayNonce] = useState(0);
  const [dated] = useAsync(
    () =>
      api.datedLessons({
        from: weekMonday,
        to: addDays(weekMonday, 6),
        classId: view === "class" ? current : undefined,
      }),
    [weekMonday, view, current, overlayNonce],
  );
  const datedByKey = useMemo(() => {
    const m = new Map<string, DatedLessonDto>();
    if (dated.status === "ready") for (const l of dated.data) m.set(lessonKey(l.date, l.slotNo, l.classId, l.groupNo), l);
    return m;
  }, [dated]);
  const reloadOverlay = () => {
    setOverlayNonce((n) => n + 1);
    onChanged?.();
  };

  // Заместитель назначается из педагогов школы (`S-40.select.substitute`, schedule.build).
  const [staff] = useAsync(() => (mayBuild ? api.staff() : Promise.resolve([] as StaffCardDto[])), [mayBuild]);
  const staffTeachers =
    staff.status === "ready"
      ? staff.data.filter((c) => c.roles.includes("teacher") && c.userId && !c.deactivated && c.name)
      : [];

  const [cancelling, setCancelling] = useState<{ lesson: DatedLessonDto; when: string } | null>(null);
  const [substFor, setSubstFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Плашка «Уроков без замены» привела к уроку: класс, неделя/день, прокрутка к строке.
  useEffect(() => {
    if (!focus) return;
    setView("class");
    setClassId(focus.classId);
    if (mobile) setOpenDate(focus.date);
    else setWeek(mondayOf(focus.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq]);
  useEffect(() => {
    if (!focus || dated.status !== "ready") return;
    document.querySelector(`[data-lesson-id="${focus.lessonId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq, dated.status]);

  /** Начало урока в минутах: по скелету (AR-171), без него — арифметика фолбэка. */
  const startMinOf = (dayNo: number, slotNo: number): number | null => {
    const sk = preview.skeleton?.length ? skeletonLessonTimes(preview.skeleton, dayNo, slotNo) : null;
    if (sk) return sk.startMin;
    return preview.grid ? hm(slotTimes(preview.grid, slotNo).start) : null;
  };
  // Кнопка отмены — на ещё не начавшихся уроках; судья — сервер (`LESSON_ALREADY_HELD`
  // по времени школы), экран лишь не предлагает заведомо прошедшее.
  const notStarted = (d: DatedLessonDto, dayNo: number): boolean => {
    if (d.date > todayIso) return true;
    if (d.date < todayIso) return false;
    const start = startMinOf(dayNo, d.slotNo);
    return start === null ? true : start > nowMin;
  };
  const whenOf = (d: DatedLessonDto, dayNo: number): string => {
    const start = startMinOf(dayNo, d.slotNo);
    return `${dayMonth(d.date)}, ${d.slotNo}-й урок${start === null ? "" : `, ${toHHMM(start)}`}`;
  };

  const statusOf = (d: DatedLessonDto): DayCellStatus | null => {
    const sub = d.substitution;
    if (!sub || sub.status === "withdrawn") return null;
    if (sub.status === "substituted") {
      return { kind: "substituted", label: `Замена: ${teacherShort(sub.substituteTeacherName ?? d.teacherName)}` };
    }
    const why = seesReason ? ` · ${LESSON_CANCEL_REASON_LABELS[sub.reason]}${sub.reasonText ? ` — ${sub.reasonText}` : ""}` : "";
    return { kind: "cancelled", label: `Отменён${why}` };
  };

  const withdraw = async (d: DatedLessonDto) => {
    setBusyId(d.lessonId);
    try {
      await api.withdrawCancel(d.lessonId);
      showToast("Отмена отозвана — урок снова у своего педагога");
      reloadOverlay();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setBusyId(null);
    }
  };
  const assign = async (d: DatedLessonDto, substituteId: string) => {
    setBusyId(d.lessonId);
    try {
      await api.setSubstitute(d.lessonId, { teacherId: substituteId });
      showToast("Замена назначена");
      setSubstFor(null);
      reloadOverlay();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setBusyId(null);
    }
  };

  /** Действия строки (AR-207): отмена своего, отзыв, ручная замена — по правам. */
  const actionsFor = (d: DatedLessonDto, dayNo: number): ReactNode => {
    const sub = d.substitution && d.substitution.status !== "withdrawn" ? d.substitution : null;
    const mayCancel = mayCancelSelf && d.teacherId === me.userId && !sub && !d.detached && notStarted(d, dayNo);
    const mayWithdraw = sub !== null && (mayBuild || (mayCancelSelf && sub.originalTeacherId === me.userId));
    const maySubstitute = sub !== null && mayBuild;
    if (!mayCancel && !mayWithdraw && !maySubstitute) return null;
    const busy = busyId === d.lessonId;
    return (
      <>
        {mayCancel ? (
          <Button
            kind="ghost"
            testId="S-40.btn.cancelLesson"
            data-lesson-id={d.lessonId}
            onClick={() => setCancelling({ lesson: d, when: whenOf(d, dayNo) })}
          >
            Отменить урок
          </Button>
        ) : null}
        {mayWithdraw ? (
          <Button kind="ghost" testId="S-40.btn.withdrawCancel" data-lesson-id={d.lessonId} loading={busy} onClick={() => withdraw(d)}>
            Отозвать отмену
          </Button>
        ) : null}
        {maySubstitute ? (
          <Button
            kind="ghost"
            testId="S-40.btn.substitute"
            data-lesson-id={d.lessonId}
            aria-expanded={substFor === d.lessonId}
            onClick={() => setSubstFor((cur) => (cur === d.lessonId ? null : d.lessonId))}
          >
            {sub?.status === "substituted" ? "Переназначить" : "Назначить замену"}
          </Button>
        ) : null}
        {maySubstitute && substFor === d.lessonId ? (
          <select
            className="sch-input"
            data-testid="S-40.select.substitute"
            aria-label="Заместитель"
            defaultValue=""
            disabled={busy}
            onChange={(e) => e.target.value && assign(d, e.target.value)}
          >
            <option value="">— выберите педагога —</option>
            {staffTeachers
              .filter((c) => c.userId !== d.teacherId)
              .map((c) => (
                <option key={c.id} value={c.userId ?? ""}>
                  {c.name}
                </option>
              ))}
          </select>
        ) : null}
      </>
    );
  };

  /**
   * Ячейки дня: шаблон, поверх него — датированный урок этой даты (педагог
   * строки — фактический, т.е. заместитель при замене). Без даты — чистый
   * шаблон (пустота дня недели для пикера).
   */
  const cellsFor = (dayNo: number, date: string | null): Map<number, DayCell[]> => {
    const map = new Map<number, DayCell[]>();
    const covered = new Set<string>();
    for (const s of preview.slots) {
      if (s.dayNo !== dayNo) continue;
      if (view === "class" ? s.classId !== current : s.teacherId !== curTeacher) continue;
      const d = date ? (datedByKey.get(lessonKey(date, s.slotNo, s.classId, s.groupNo)) ?? null) : null;
      if (d) covered.add(d.lessonId);
      const cells = map.get(s.slotNo) ?? [];
      const overlay = {
        status: d ? statusOf(d) : null,
        actions: d ? actionsFor(d, dayNo) : null,
        lessonId: d?.lessonId ?? null,
      };
      cells.push(
        view === "class"
          ? {
              key: `${s.subjectId}·${s.groupNo ?? 0}`,
              title: s.subjectName + (s.groupNo ? ` · гр. ${s.groupNo}` : ""),
              // в строке вместо исходного педагога — заместитель (AR-207)
              sub: d?.teacherName ?? s.teacherName,
              ...overlay,
            }
          : {
              // неделя преподавателя: что ведёт и у кого — класс вместо педагога
              key: `${s.subjectId}·${s.classId}·${s.groupNo ?? 0}`,
              title: s.subjectName + (s.groupNo ? ` · гр. ${s.groupNo}` : ""),
              sub: `${s.classLabel} класс`,
              ...overlay,
            },
      );
      map.set(s.slotNo, cells);
    }
    // Неделя преподавателя: уроки, доставшиеся ему заменой, в шаблоне не стоят —
    // они приходят из датированного оверлея (AR-207).
    if (view === "teacher" && date && dated.status === "ready") {
      for (const d of dated.data) {
        if (d.date !== date || d.teacherId !== curTeacher || d.detached || covered.has(d.lessonId)) continue;
        const cells = map.get(d.slotNo) ?? [];
        const original = d.substitution?.originalTeacherName;
        cells.push({
          key: `dated·${d.lessonId}`,
          title: d.subjectName + (d.groupNo ? ` · гр. ${d.groupNo}` : ""),
          sub: `${d.classLabel} класс${original ? ` · за ${teacherShort(original)}` : ""}`,
          status: statusOf(d),
          actions: actionsFor(d, dayNo),
          lessonId: d.lessonId,
        });
        map.set(d.slotNo, cells);
      }
    }
    return map;
  };
  // Обед класса (AR-200) — только в виде класса; неделя преподавателя строк обеда не несёт.
  const lunchOf = (cid: string): number | null =>
    preview.classLunch?.find((e) => e.classId === cid)?.lunchAfterLessonNo ?? null;
  const rowsFor = (dayNo: number, date: string | null) =>
    buildDayRows({
      skeleton: preview.skeleton,
      grid: preview.grid,
      dayNo,
      cellsByLesson: cellsFor(dayNo, date),
      lunchAfterLessonNo: view === "class" ? lunchOf(current) : null,
    });

  const filterBar = (
    <div className="sch-sched-filters">
      <div className="sch-chips" data-testid="S-40.view">
        <Button kind="chip" aria-pressed={view === "class"} onClick={() => setView("class")}>
          Класс
        </Button>
        <Button kind="chip" aria-pressed={view === "teacher"} onClick={() => setView("teacher")}>
          Преподаватель
        </Button>
      </div>
      {view === "class" ? (
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
      ) : (
        <div className="sch-field" data-testid="S-40.select.teacher">
          <span className="sch-field-label">Преподаватель</span>
          <select className="sch-input" value={curTeacher} onChange={(e) => setTeacherId(e.target.value)}>
            {teachers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* «Мои предпочтения» (AR-206): в панели фильтров; на телефоне — во всю ширину под ней (§6). */}
      {onPreferences ? (
        <Button kind="secondary" testId="S-40.btn.preferences" onClick={onPreferences}>
          Мои предпочтения
        </Button>
      ) : null}
    </div>
  );
  // Оверлей не прочитался — шаблон виден, причина названа словами (§0), не молчание.
  const overlayNote =
    dated.status === "error" ? (
      <p className="sch-warning-text sch-sched-overlay-error" role="status">
        Отмены и замены недели не прочитались: {dated.message}
      </p>
    ) : null;
  const layers = (
    <>
      {cancelling ? (
        <CancelLessonModal
          lesson={cancelling.lesson}
          when={cancelling.when}
          onClose={(done) => {
            setCancelling(null);
            if (done) reloadOverlay();
          }}
        />
      ) : null}
      {toast ? <Toast text={toast} /> : null}
    </>
  );

  // пустота дня зависит только от дня недели: шаблон повторяется еженедельно
  const dayEmpty = [0, 1, 2, 3, 4, 5, 6].map((d) => rowsFor(d, null).length === 0);

  if (mobile) {
    return (
      <div className="sch-stack">
        {filterBar}
        {overlayNote}
        <DayPicker
          testId="S-40.daystrip"
          days={days.map((d) => ({ ...d, muted: dayEmpty[d.dayNo] }))}
          open={openDay}
          onOpen={setOpenDate}
        />
        {/* key: смена дня перезапускает раскрытие сверху вниз (`sch-unfold`) */}
        <DayLessonList
          key={`${view}-${view === "class" ? current : curTeacher}-${openDay}`}
          rows={rowsFor(dayNoOf(openDay), openDay)}
          testId="S-40.grid.week"
          pairedTestId="S-40.cell.paired"
          cancelledTestId="S-40.cell.cancelled"
          substitutedTestId="S-40.cell.substituted"
        />
        {layers}
      </div>
    );
  }

  return (
    <div className="sch-stack">
      {filterBar}
      {overlayNote}
      <WeekStrip testId="S-40.weeks" weeks={weeks} open={openWeek} onOpen={setWeek} />
      <Days33
        testId="S-40.grid.week"
        dayNos={[0, 1, 2, 3, 4, 5]}
        header={(d) => `${DAY_NAMES[d]} · ${dayMonth(addDays(openWeek, d))}`}
        render={(d) => (
          // день вне четвертей (31 августа, каникулы) уроков не несёт
          <DayLessonList
            rows={inTerms(addDays(openWeek, d), termList) ? rowsFor(d, addDays(openWeek, d)) : []}
            pairedTestId="S-40.cell.paired"
            cancelledTestId="S-40.cell.cancelled"
            substitutedTestId="S-40.cell.substituted"
          />
        )}
      />
      {layers}
    </div>
  );
}

/**
 * `M-30` «Мои предпочтения» (AR-206): рабочие дни педагог задаёт сам, без
 * утверждения (уточнение AR-135). Чипы ПН…СБ по учебным дням школы, ни одного
 * выбранного — любой день; заметка строителю необязательна. Сохранение —
 * событие `schedule.preference.set.v1`, подтверждённая сетка уходит в `stale`.
 */
function PreferencesModal({ days, onClose, onSaved }: { days: number; onClose: () => void; onSaved: () => void }) {
  const [workDays, setWorkDays] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .myPreference()
      .then((p) => {
        if (!alive) return;
        setWorkDays(p.workDays);
        setNote(p.note ?? "");
      })
      .catch((e) => alive && setError(e instanceof SchoolApiError ? e.message : "Не удалось прочитать предпочтения"))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (d: number) =>
    setWorkDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setMyPreference({ workDays, note: note.trim() || null });
      onSaved();
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Мои предпочтения"
      width={480}
      onClose={onClose}
      testId="M-30"
      mobile="sheet"
      footer={
        <div className="sch-actions">
          <Button kind="primary" testId="M-30.btn.save" disabled={!ready} loading={busy} onClick={save}>
            Сохранить
          </Button>
        </div>
      }
    >
      <p className="sch-muted">
        Дни, в которые вы можете вести уроки: генератор ставит ваши часы только в них. Ни одного выбранного — любой день.
      </p>
      {!ready ? (
        <Skeletons count={2} kind="row" />
      ) : (
        <>
          <div className="sch-chips" role="group" aria-label="Рабочие дни">
            {Array.from({ length: days }, (_, d) => (
              <Button
                key={d}
                kind="chip"
                testId="M-30.chip.day"
                data-day={d}
                aria-pressed={workDays.includes(d)}
                onClick={() => toggle(d)}
              >
                {DAY_NAMES[d].toUpperCase()}
              </Button>
            ))}
          </div>
          <Field
            label="Заметка строителю"
            hint="необязательно"
            testId="M-30.input.note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}
      {error ? (
        <p className="sch-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

/**
 * `M-31` «Отмена урока» (AR-207): причина из словаря без сведений о здоровье,
 * пояснение — штатным ролям с правом; замену подбирает СЕРВЕР, итог — в той
 * же модалке («Замена: Иванова М. И.» / «Замены нет — сообщено завучу»).
 * Отказ (`NOT_YOUR_LESSON`, `LESSON_ALREADY_HELD`, `LESSON_CANCELLED`,
 * `LESSON_DETACHED`) — текстом §9, форма остаётся открытой с причиной.
 */
function CancelLessonModal({
  lesson,
  when,
  onClose,
}: {
  lesson: DatedLessonDto;
  /** «15 сентября, 3-й урок, 10:00» — что именно отменяется. */
  when: string;
  /** `done` — отмена состоялась, экран перечитывает оверлей. */
  onClose: (done: boolean) => void;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState<LessonCancelReason>("absence");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubstitutionResultDto | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.cancelLesson(lesson.lessonId, { reason, reasonText: text.trim() || undefined }));
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Отмена урока"
      width={480}
      onClose={() => onClose(result !== null)}
      testId="M-31"
      mobile="sheet"
      footer={
        <div className="sch-actions">
          {result ? (
            <Button kind="primary" onClick={() => onClose(true)}>
              Закрыть
            </Button>
          ) : (
            <Button kind="primary" testId="M-31.btn.submit" loading={busy} onClick={submit}>
              Отменить урок
            </Button>
          )}
        </div>
      }
    >
      <p className="sch-m31-lesson">
        {lesson.subjectName} · {lesson.classLabel} класс{lesson.groupNo ? `, группа ${lesson.groupNo}` : ""} · {when}
      </p>
      {result ? (
        <div className="sch-m31-result" data-testid="M-31.result" data-status={result.status} role="status">
          {result.status === "substituted"
            ? `Замена: ${teacherInitials(result.substituteTeacherName)}`
            : "Замены нет — сообщено завучу"}
        </div>
      ) : (
        <>
          <div className="sch-field">
            <label className="sch-field-label" htmlFor={reasonId}>
              Причина
            </label>
            <select
              id={reasonId}
              className="sch-input"
              data-testid="M-31.select.reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as LessonCancelReason)}
            >
              {LESSON_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {LESSON_CANCEL_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Пояснение"
            hint="видят завуч и модератор"
            testId="M-31.input.reasonText"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="sch-muted">
            Замену подберёт программа: педагог того же предмета, свободный в этот час и работающий в этот день. Если
            такого нет — урок отменяется, а завуч увидит его в «Уроках без замены».
          </p>
        </>
      )}
      {error ? (
        <p className="sch-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

/**
 * Недели учебного года по четвертям календаря (`S-40.weeks`): от понедельника
 * первой четверти до недели конца последней; недели вне четвертей — каникулы,
 * приглушены. Календарь не прочитался — одна текущая неделя, экран живёт.
 */
function termWeeks(terms: TermDto[], todayIso: string): { monday: string; label: string; muted?: boolean }[] {
  const label = (mon: string) => weekRange(mon, addDays(mon, 5));
  const filled = terms.filter((t) => t.dateFrom && t.dateTo);
  if (!filled.length) {
    const mon = mondayOf(todayIso);
    return [{ monday: mon, label: label(mon) }];
  }
  const from = mondayOf(filled.reduce((a, t) => (t.dateFrom < a ? t.dateFrom : a), filled[0].dateFrom));
  const to = mondayOf(filled.reduce((a, t) => (t.dateTo > a ? t.dateTo : a), filled[0].dateTo));
  const out: { monday: string; label: string; muted?: boolean }[] = [];
  // ISO-строки сравниваются лексикографически; предохранитель — год недель.
  for (let mon = from; mon <= to && out.length < 60; mon = addDays(mon, 7)) {
    const sat = addDays(mon, 5);
    out.push({ monday: mon, label: label(mon), muted: !filled.some((t) => t.dateFrom <= sat && mon <= t.dateTo) });
  }
  return out;
}

// ─────────────────────────── сетка предпросмотра (S-42/S-43) ───────────────────────────

/** Слот для ручной перестановки `S-43`: класс + место в неделе. */
export interface PickedSlot {
  dayNo: number;
  slotNo: number;
  classId: string;
}

interface PickProps {
  sel: PickedSlot | null;
  on: (p: PickedSlot) => void;
}

/**
 * Табличная сетка всей школы — предпросмотр `S-42`; на мобайле — лента дней.
 * В черновике ячейки выбираемы (`S-43`): первый клик помечает урок, второй —
 * по слоту ТОГО ЖЕ класса — переставляет их местами (пустой слот легален:
 * это перенос урока в окно).
 */
export function WeekGrid({ preview, testId, pick }: { preview: SchedulePreviewDto; testId: string; pick?: PickProps }) {
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
  if (mobile) return <WeekGridMobile preview={preview} testId={testId} classes={classes} maxSlot={maxSlot} days={days} pick={pick} />;

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
                  const picked = pick?.sel && pick.sel.classId === id && pick.sel.dayNo === d && pick.sel.slotNo === s + 1;
                  return (
                    <td
                      key={`${d}-${s}`}
                      className={
                        (paired ? "sch-cell--paired" : "") + (picked ? " sch-cell--picked" : "") || undefined
                      }
                      data-testid={cell.length && pick ? "S-43.cell" : paired ? "S-40.cell.paired" : undefined}
                      data-swap-class={cell.length && pick ? id : undefined}
                      onClick={pick ? () => pick.on({ dayNo: d, slotNo: s + 1, classId: id }) : undefined}
                      style={pick ? { cursor: "pointer" } : undefined}
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
 * Предпросмотр `S-42` на мобайле: один класс за раз, лента дней, уроки
 * карточками. Широкое содержимое скроллится ВНУТРИ контейнера — `body` по
 * горизонтали не скроллится никогда (§6).
 */
function WeekGridMobile({
  preview,
  testId,
  classes,
  maxSlot,
  days,
  pick,
}: {
  preview: SchedulePreviewDto;
  testId: string;
  classes: [string, string][];
  maxSlot: number;
  days: number;
  pick?: PickProps;
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
          const picked = pick?.sel && pick.sel.classId === current && pick.sel.dayNo === day && pick.sel.slotNo === s + 1;
          const t = slotTimes(preview.grid, s + 1);
          const hasNext = preview.slots.some((x) => x.classId === current && x.dayNo === day && x.slotNo === s + 2);
          return (
            <div key={s} className="sch-stack" style={{ gap: 0 }}>
              <div
                className={"sch-lesson" + (picked ? " sch-cell--picked" : "")}
                data-testid={pick ? "S-43.cell" : paired ? "S-40.cell.paired" : undefined}
                data-swap-class={pick ? current : undefined}
                onClick={pick ? () => pick.on({ dayNo: day, slotNo: s + 1, classId: current }) : undefined}
              >
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

// ─────────────── S-41 · настройка расписания: одна модалка (M-08) ───────────────

const emptyTerms = (): TermDto[] =>
  [1, 2, 3, 4].map((n) => ({ termNo: n as 1 | 2 | 3 | 4, dateFrom: "", dateTo: "" }));

/** Четыре панели по порядку номеров — реестр требует именно четыре (`S-41.panel.term[1..4]`). */
const byTermNo = (rows: TermDto[]): TermDto[] =>
  [1, 2, 3, 4].map(
    (n) => rows.find((t) => t.termNo === n) ?? { termNo: n as 1 | 2 | 3 | 4, dateFrom: "", dateTo: "" },
  );

/** Отказ ведёт к КОНКРЕТНОМУ разделу настройки (`S-42.refusal`). */
const SECTION_BY_CODE: Record<string, string> = {
  TERM_OVERLAP: "terms",
  TERM_REVERSED: "terms",
  LOAD_EXCEEDS_SANPIN: "load",
  GROUP_HOURS_UNEQUAL: "load",
  SUBJECT_UNCOVERED: "load",
  GROUPS_UNASSIGNED: "load",
  TEACHER_DAYS_SHORT: "load",
  LOAD_EXCEEDS_GRID: "day",
  TEACHER_OVERBOOKED: "day",
  DAY_EXCEEDS_SANPIN: "day",
  DAY_TOO_LONG: "day",
  SKELETON_INVALID: "skeleton",
  NO_SOLUTION: "priorities",
};

/** Строка редактора скелета: времена «HH:MM», тип и название для событий. */
interface SkelRow {
  kind: SkeletonKind;
  title: string;
  start: string;
  end: string;
}

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Позиции скелета из строк редактора: `posNo` — порядок по времени, `lessonNo`
 * — сквозной номер урока в дне, пары при `paired` собираются САМИ из смежных
 * уроков без зазора (конец первого = начало второго) — человек вводит времена,
 * а не номера пар.
 */
function buildPositions(days: Map<number, SkelRow[]>, gridKind: GridKind): SkeletonPositionDto[] {
  const out: SkeletonPositionDto[] = [];
  let pairNo = 0;
  for (const [dayNo, rows] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = rows.filter((r) => r.start && r.end).slice().sort((a, b) => a.start.localeCompare(b.start));
    let lessonNo = 0;
    let prev: SkeletonPositionDto | null = null;
    sorted.forEach((r, i) => {
      const dto: SkeletonPositionDto = {
        dayNo,
        posNo: i + 1,
        kind: r.kind,
        title: r.kind === "lesson" ? null : r.title || (r.kind === "meal" ? "Обед" : "Событие"),
        startMin: toMin(r.start),
        endMin: toMin(r.end),
        lessonNo: r.kind === "lesson" ? ++lessonNo : null,
        pairNo: null,
      };
      if (
        gridKind === "paired" &&
        dto.kind === "lesson" &&
        prev &&
        prev.kind === "lesson" &&
        prev.pairNo === null &&
        prev.posNo === dto.posNo - 1 &&
        prev.endMin === dto.startMin
      ) {
        pairNo += 1;
        prev.pairNo = pairNo;
        dto.pairNo = pairNo;
      }
      out.push(dto);
      prev = dto;
    });
  }
  return out;
}

/** Строки редактора из сохранённых позиций — обратная сторона `buildPositions`. */
function rowsFromPositions(positions: SkeletonPositionDto[]): Map<number, SkelRow[]> {
  const map = new Map<number, SkelRow[]>();
  for (const p of positions) {
    const rows = map.get(p.dayNo) ?? [];
    rows.push({ kind: p.kind, title: p.title ?? "", start: toHHMM(p.startMin), end: toHHMM(p.endMin) });
    map.set(p.dayNo, rows);
  }
  return map;
}

/**
 * Форма настройки — ОДНА, из двух мест: полноэкранная модалка `M-08` (первая
 * настройка и правка) и вкладка «Настройка» результата `S-42`. Все разделы
 * видны сразу; «Сгенерировать» сохраняет их по порядку (четверти → приоритеты
 * → скелет → параметры дня) и запускает генерацию. Нагрузка здесь ЧИТАЕТСЯ
 * (AR-180): годовые нормы живут в «Нормах часов» (`M-22`).
 */
function SettingsForm({
  onGenerated,
  onDirty,
  onRefusalClose,
  preset,
}: {
  onGenerated: (p: SchedulePreviewDto) => void;
  onDirty?: (dirty: boolean) => void;
  /** Вкладка «Настройка» уже полноэкранна — отказ там закрывается на месте. */
  onRefusalClose?: () => void;
  /** Прошлый шаблон: параметры дня предзаполняются, а не перевбиваются. */
  preset?: SchedulePreviewDto | null;
}) {
  const [terms, setTerms] = useState<TermDto[]>(emptyTerms);
  const [ready, setReady] = useState(false);
  const [load, setLoad] = useState<{ entries: LoadEntry[]; version: number } | null>(null);
  // Приоритеты выбираются ПО ИМЕНАМ дисциплин (правка владельца 2026-08-31:
  // «просто математика», не «математика 1..3»); в контракт при генерации имя
  // разворачивается в subjectId всех карточек этого имени во всех классах.
  const [prioNames, setPrioNames] = useState<string[]>([]);
  const [noPriority, setNoPriority] = useState(false);
  const [prioTouched, setPrioTouched] = useState(false);
  const [day, setDay] = useState(() =>
    preset
      ? {
          slotsPerDay: String(Math.max(1, ...preset.slots.map((s) => s.slotNo))),
          lessonMin: String(preset.grid.lessonMin),
          breakMin: String(preset.grid.breakMin),
          days: Math.max(5, ...preset.slots.map((s) => s.dayNo + 1)),
          bigBreakAfter: preset.grid.bigBreakAfter,
          bigBreakMin: String(preset.grid.bigBreakMin),
          dayStart: `${String(Math.floor(preset.grid.dayStartMin / 60)).padStart(2, "0")}:${String(preset.grid.dayStartMin % 60).padStart(2, "0")}`,
        }
      : { slotsPerDay: "", lessonMin: "45", breakMin: "10", days: 5, bigBreakAfter: 2, bigBreakMin: "20", dayStart: "09:00" },
  );
  const [gridKind, setGridKind] = useState<GridKind>("paired");
  const [skelDays, setSkelDays] = useState<Map<number, SkelRow[]>>(new Map());
  const [skelDay, setSkelDay] = useState(0);
  const [skelTouched, setSkelTouched] = useState(false);
  // Рабочие дни педагогов (AR-206) — строителю в сводке нагрузки, только чтение.
  const [prefs, setPrefs] = useState<TeacherPreferenceDto[]>([]);
  // Обед по классам (AR-200): `null` — как у школы; пишется `PUT /schedule/lunch`.
  const [classes, setClasses] = useState<ClassDto[]>([]);
  const [lunch, setLunch] = useState<Map<string, number | null>>(new Map());
  const [lunchTouched, setLunchTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  const { toast, showToast } = useToast();

  const [subjects] = useAsync(() => api.subjects());
  const subjNames =
    subjects.status === "ready"
      ? [...new Set(subjects.data.map((s) => s.name))].sort((a, b) => a.localeCompare(b, "ru"))
      : [];

  /**
   * Всё разом при открытии: четверти (свои или рекомендованный график ФООП —
   * базис #5), нагрузка, скелет. Пустые панели с нуля — лишний ввод, и реестр
   * их не разрешает.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, l, sk, pr, cl] = await Promise.all([
        api.terms().catch(() => [] as TermDto[]),
        api.load().catch(() => null),
        api.skeleton().catch(() => null),
        api.teacherPreferences().catch(() => [] as TeacherPreferenceDto[]),
        api.classes().catch(() => null),
      ]);
      if (!alive) return;
      setTerms(t.length ? byTermNo(t) : recommendedTerms(new Date().toISOString().slice(0, 10)));
      if (l) setLoad(l);
      if (sk) {
        setGridKind(sk.gridKind);
        if (sk.positions.length) setSkelDays(rowsFromPositions(sk.positions));
      }
      setPrefs(pr);
      if (cl) {
        setClasses(cl.classes);
        // источник — колонка класса; `classLunch` скелета тот же факт с той же версией
        const m = new Map<string, number | null>();
        for (const c of cl.classes) m.set(c.id, c.lunchAfterLessonNo ?? null);
        for (const e of sk?.classLunch ?? []) m.set(e.classId, e.lunchAfterLessonNo);
        setLunch(m);
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [touched, setTouched] = useState(false);
  // «Введённое» — сравнением с исходным, а не фактом заполненности: у формы с
  // предзаполнением параметры дня не пусты с порога, и выход без правок не
  // должен спрашивать подтверждение (сценарий «открыл-посмотрел-закрыл»).
  const [day0] = useState(() => JSON.stringify(day));
  const dirty = JSON.stringify(day) !== day0 || prioTouched || skelTouched || lunchTouched || touched;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const termsValid = terms.every((t) => t.dateFrom && t.dateTo);
  const loadValid = !!load && load.entries.every((e) => e.hoursPerWeek > 0);
  const canGenerate = termsValid && loadValid && day.slotsPerDay !== "" && (prioNames.length > 0 || noPriority || !ready);

  const dayLength = (): number => {
    const slots = Number(day.slotsPerDay) || 0;
    const breaks = Math.max(0, slots - 1);
    const big = day.bigBreakAfter > 0 && day.bigBreakAfter < slots ? 1 : 0;
    return slots * Number(day.lessonMin) + (breaks - big) * Number(day.breakMin) + big * Number(day.bigBreakMin);
  };

  const scrollToSection = (code: string) => {
    const key = SECTION_BY_CODE[code] ?? "day";
    document.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /** Сохранения по порядку, потом генерация; версии — свежие (AR-109). */
  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.setTerms(terms);
      // Нагрузку форма НЕ шлёт (AR-180): нормы принадлежат «Нормам часов»,
      // здесь они только читаются.
      if (prioTouched || prioNames.length > 0 || noPriority) {
        // Имя → subjectId всех карточек имени: приоритет ставится предмету
        // сразу во всех классах, контракт SetPrioritiesDto не меняется.
        const ids =
          subjects.status === "ready" ? subjects.data.filter((s) => prioNames.includes(s.name)).map((s) => s.id) : [];
        await api.setPriorities({ subjectIds: ids, explicitNone: noPriority || ids.length === 0 });
      }
      if (skelTouched) {
        const sk = await api.skeleton();
        await api.setSkeleton({ gridKind, positions: buildPositions(skelDays, gridKind), version: sk.version });
      }
      if (lunchTouched) {
        // Обед по классам (AR-200): после скелета, до параметров дня; версия —
        // свежая, скелет только что мог её поднять (AR-109).
        const sk = await api.skeleton();
        await api.setLunch({
          version: sk.version,
          entries: classes.map((c) => ({ classId: c.id, lunchAfterLessonNo: lunch.get(c.id) ?? null })),
        });
      }
      const l2 = await api.load();
      await api.setDayParams({
        slotsPerDay: Number(day.slotsPerDay),
        lessonMin: Number(day.lessonMin),
        breakMin: Number(day.breakMin),
        days: day.days as 5 | 6,
        bigBreakAfter: day.bigBreakAfter,
        bigBreakMin: Number(day.bigBreakMin),
        dayStartMin: Number(day.dayStart.slice(0, 2)) * 60 + Number(day.dayStart.slice(3, 5)),
        version: l2.version,
      });
      const p = await api.generate();
      setGenerating(false);
      onGenerated(p);
    } catch (e) {
      setGenerating(false);
      if (e instanceof SchoolApiError) setRefusal({ code: e.code, message: e.message });
      else setError("Не удалось сгенерировать");
    }
  };

  if (!ready) return <Skeletons count={4} kind="row" />;

  const skelRows = skelDays.get(skelDay) ?? [];
  // Верхняя граница обеда класса (AR-200): урочных позиций дня − 1 — по скелету,
  // без скелета — по «уроков в день» фолбэка.
  const skelLessonMax = Math.max(0, ...[...skelDays.values()].map((rows) => rows.filter((r) => r.kind === "lesson").length));
  const lunchMax = (skelLessonMax > 0 ? skelLessonMax : Number(day.slotsPerDay) || 0) - 1;
  const setSkelRows = (rows: SkelRow[]) => {
    setSkelTouched(true);
    setSkelDays((cur) => {
      const next = new Map(cur);
      next.set(skelDay, rows);
      return next;
    });
  };

  return (
    <div className="sch-stack" style={{ gap: "var(--sp-24)" }}>
      {/* ── Четверти. Даты уходят В КАЛЕНДАРЬ: модалка их не хранит (AR-68). ── */}
      <section data-section="terms" className="sch-stack">
        <h3 className="sch-section-title">Четверти</h3>
        <div className="sch-terms">
          {terms.map((t, i) => (
            <div className="sch-term-panel" key={t.termNo} data-testid={`S-41.panel.term${t.termNo}`} data-valid={Boolean(t.dateFrom && t.dateTo)}>
              <div className="sch-row sch-row--between">
                <strong>{t.termNo} четверть</strong>
                {t.dateFrom && t.dateTo ? (
                  <span className="sch-success-text" data-testid="S-41.term.check" aria-label="Даты заданы">
                    <Icon name="check" size={18} />
                  </span>
                ) : null}
              </div>
              <Field
                label="Начало"
                type="date"
                value={t.dateFrom}
                onChange={(e) => {
                  setTouched(true);
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
                  setTouched(true);
                  const next = [...terms];
                  next[i] = { ...t, dateTo: e.target.value };
                  setTerms(next);
                }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── Нагрузка — ЧТЕНИЕ (AR-180): годовые нормы ставит завуч в «Нормах
             часов» на экране расписания; модератор здесь видит производные
             недельные часы и знает, чего не хватает генератору. ── */}
      <section data-section="load" className="sch-stack">
        <h3 className="sch-section-title">Нагрузка</h3>
        <div className="sch-card sch-stack" data-testid="S-41.load.summary" style={{ gap: "var(--sp-8)" }}>
          {!load || load.entries.length === 0 ? (
            <p className="sch-muted">Привязок педагогов пока нет — привяжите их в «Предметах»</p>
          ) : (
            [...new Map(load.entries.map((e) => [e.teacherId, e.teacherName])).entries()].map(([tid, tname]) => {
              // рабочие дни педагога (AR-206): пусто — любой день; генератор чтит их жёстко
              const wd = prefs.find((x) => x.teacherId === tid)?.workDays ?? [];
              const daysLabel = wd.length ? [...wd].sort((a, b) => a - b).map((d) => DAY_NAMES[d].toUpperCase()).join(", ") : "любой день";
              return (
                <div className="sch-stack sch-s41-teacher" key={tid} data-teacher-id={tid}>
                  <div className="sch-row sch-row--between">
                    <strong>{tname}</strong>
                    <span className="sch-muted sch-s41-teacher-days">дни: {daysLabel}</span>
                  </div>
                  {load.entries
                    .filter((e) => e.teacherId === tid)
                    .map((e) => (
                      <div className="sch-row sch-row--between" key={e.bindingId}>
                        <span>
                          {e.subjectName} · {e.classLabel} класс
                          {e.scope === "group" ? `, группа ${e.groupNos.join(", ")}` : ""}
                        </span>
                        {e.hoursPerWeek > 0 ? (
                          <span className="sch-muted">
                            {e.hoursPerYear} ч/год · {e.hoursPerWeek} ч/нед
                          </span>
                        ) : (
                          <span className="sch-warning-text">норма не задана</span>
                        )}
                      </div>
                    ))}
                </div>
              );
            })
          )}
          <p className="sch-muted">
            Годовые нормы часов задаёт завуч — кнопка «Нормы часов» на экране расписания. Недельные часы для
            генератора считаются из них автоматически.
          </p>
        </div>
      </section>

      {/* ── Приоритеты + ЯВНЫЙ отказ (AR-77). ── */}
      <section data-section="priorities" className="sch-stack">
        <h3 className="sch-section-title">Приоритетные предметы</h3>
        <div className="sch-chips" data-testid="S-41.chips.priority">
          {subjNames.map((name) => (
            <Button
              key={name}
              kind="chip"
              aria-pressed={prioNames.includes(name)}
              onClick={() => {
                setPrioTouched(true);
                setNoPriority(false);
                setPrioNames((cur) => (cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]));
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        <Button
          kind="off"
          testId="S-41.btn.noPriority"
          aria-pressed={noPriority}
          onClick={() => {
            setPrioTouched(true);
            setNoPriority(true);
            setPrioNames([]);
          }}
        >
          ⌀ Без приоритетов
        </Button>
      </section>

      {/* ── Параметры дня. Длину дня и число уроков задаёт школа: нормативных
             потолков нет (AR-199 вытесняет AR-103/AR-114), подсказок СанПиН нет.
             «Уроков в день» — одно число на школу, вместимость дня всех
             параллелей в бесскелетном фолбэке. ── */}
      <section data-section="day" className="sch-stack">
        <h3 className="sch-section-title">Параметры дня</h3>
        <NumberField
          label="Уроков в день"
          hint="одно число на школу — вместимость дня для всех параллелей"
          testId="S-41.input.slotsPerDay"
          min={1}
          max={12}
          value={day.slotsPerDay}
          onValue={(v) => setDay({ ...day, slotsPerDay: v })}
        />
        <NumberField
          label="Длина урока, минут"
          testId="S-41.input.lessonMin"
          min={20}
          max={90}
          value={day.lessonMin}
          onValue={(v) => setDay({ ...day, lessonMin: v })}
        />
        <NumberField
          label="Длина перемены, минут"
          testId="S-41.input.breakMin"
          min={5}
          max={60}
          value={day.breakMin}
          onValue={(v) => setDay({ ...day, breakMin: v })}
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
          min={5}
          max={90}
          value={day.bigBreakMin}
          onValue={(v) => setDay({ ...day, bigBreakMin: v })}
        />
        {/* Потребитель четырёх временных параметров — справка без потолка (AR-199). */}
        <p className="sch-muted" data-testid="S-41.calc.dayLength">
          Учебный день: {dayLength()} минут
        </p>
      </section>

      {/* ── Скелет дня (AR-171): явные времена; пары собираются из смежных уроков. ── */}
      <section data-section="skeleton" className="sch-stack" data-testid="S-41.skeleton">
        <h3 className="sch-section-title">Скелет дня</h3>
        <p className="sch-muted">
          Точные времена позиций дня: уроки, обед и события в общей нумерации. Пары складываются сами из смежных
          уроков без зазора. Пусто — времена считаются из параметров дня.
        </p>
        <div className="sch-chips" data-testid="S-41.grid.kind">
          <Button kind="chip" aria-pressed={gridKind === "paired"} onClick={() => { setSkelTouched(true); setGridKind("paired"); }}>
            Спаренная сетка
          </Button>
          <Button kind="chip" aria-pressed={gridKind === "variable"} onClick={() => { setSkelTouched(true); setGridKind("variable"); }}>
            Варьируемая
          </Button>
        </div>
        <div className="sch-chips" data-testid="S-41.skel.day">
          {Array.from({ length: day.days }, (_, d) => (
            <Button key={d} kind="chip" aria-pressed={skelDay === d} onClick={() => setSkelDay(d)}>
              {DAY_NAMES[d]}
              {(skelDays.get(d)?.length ?? 0) > 0 ? ` · ${skelDays.get(d)!.length}` : ""}
            </Button>
          ))}
        </div>
        <div className="sch-stack" style={{ gap: "var(--sp-8)" }}>
          {skelRows.map((r, i) => (
            <div className="sch-skel-row" key={i} data-testid="S-41.skel.row">
              <select
                className="sch-input"
                value={r.kind}
                aria-label="Тип позиции"
                onChange={(e) => setSkelRows(skelRows.map((x, j) => (j === i ? { ...x, kind: e.target.value as SkeletonKind } : x)))}
              >
                <option value="lesson">Урок</option>
                <option value="meal">Обед</option>
                <option value="event">Событие</option>
              </select>
              {r.kind !== "lesson" ? (
                <input
                  className="sch-input"
                  placeholder={r.kind === "meal" ? "Обед/прогулка" : "Линейка"}
                  aria-label="Название"
                  value={r.title}
                  onChange={(e) => setSkelRows(skelRows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
              ) : null}
              <input
                className="sch-input"
                type="time"
                aria-label="Начало"
                value={r.start}
                onChange={(e) => setSkelRows(skelRows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
              />
              <input
                className="sch-input"
                type="time"
                aria-label="Конец"
                value={r.end}
                onChange={(e) => setSkelRows(skelRows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
              />
              <Button kind="ghost" aria-label="Убрать позицию" onClick={() => setSkelRows(skelRows.filter((_, j) => j !== i))}>
                <Icon name="close" />
              </Button>
            </div>
          ))}
        </div>
        <div className="sch-actions">
          <Button
            kind="secondary"
            testId="S-41.skel.add.lesson"
            onClick={() => {
              const last = skelRows[skelRows.length - 1];
              const start = last?.end || "09:00";
              setSkelRows([...skelRows, { kind: "lesson", title: "", start, end: toHHMM(toMin(start) + Number(day.lessonMin || "40")) }]);
            }}
          >
            <Icon name="plus" size={18} />
            Урок
          </Button>
          <Button
            kind="secondary"
            testId="S-41.skel.add.event"
            onClick={() => {
              const last = skelRows[skelRows.length - 1];
              const start = last?.end || "12:00";
              setSkelRows([...skelRows, { kind: "event", title: "", start, end: toHHMM(toMin(start) + 15) }]);
            }}
          >
            <Icon name="plus" size={18} />
            Событие
          </Button>
          {skelRows.length ? (
            <Button
              kind="ghost"
              testId="S-41.skel.copy"
              onClick={() => {
                setSkelTouched(true);
                setSkelDays((cur) => {
                  const next = new Map(cur);
                  for (let d = 0; d < day.days; d += 1) next.set(d, skelRows.map((r) => ({ ...r })));
                  return next;
                });
              }}
            >
              Скопировать на все дни
            </Button>
          ) : null}
        </div>

        {/* ── Обед по классам (AR-200): строка на класс, «как у школы» = общий meal
               скелета; у класса с обедом после N-го урочная позиция N+1 без урока.
               Сохраняется в общем потоке «Сгенерировать» после скелета. ── */}
        {classes.length > 0 ? (
          <div className="sch-s41-lunch" data-testid="S-41.lunch">
            <strong>Обед по классам</strong>
            <p className="sch-muted">
              После какого урока обедает класс. У класса со своим обедом следующая позиция дня остаётся без урока, общий
              обед школы ему не показывается; «как у школы» — обед из скелета дня.
            </p>
            {classes.map((c) => {
              const v = lunch.get(c.id) ?? null;
              const opts = Array.from({ length: Math.max(0, lunchMax) }, (_, i) => i + 1);
              if (v !== null && !opts.includes(v)) opts.push(v);
              return (
                <div className="sch-s41-lunch-row" key={c.id} data-testid="S-41.lunch.row">
                  <strong>{c.label}</strong>
                  <select
                    className="sch-input"
                    data-testid="S-41.lunch.select"
                    aria-label={`Обед: ${c.label}`}
                    value={v === null ? "" : String(v)}
                    onChange={(e) => {
                      setLunchTouched(true);
                      const next = e.target.value === "" ? null : Number(e.target.value);
                      setLunch((cur) => {
                        const m = new Map(cur);
                        m.set(c.id, next);
                        return m;
                      });
                    }}
                  >
                    <option value="">как у школы</option>
                    {opts.map((n) => (
                      <option key={n} value={n}>
                        после {n}-го урока
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="sch-danger-text" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sch-actions">
        {/* Единственная РОЗОВАЯ кнопка потока — ключевое действие (AR-80). */}
        <Button kind="accent" testId="S-41.btn.generate" disabled={!canGenerate} loading={generating} onClick={generate}>
          Сгенерировать
        </Button>
      </div>

      {/*
        M-09 — полноэкранный прогресс генерации с кнопкой «Отменить» (AR-107).
        Идентификатор `M-09` принадлежит ЕМУ, а не предпросмотру (реестр §3).
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
                showToast("Генерация отменена — параметры сохранены, сетка не создана");
              }}
            >
              Отменить
            </Button>
          </div>
        </div>
      ) : null}

      {/* M-10 — отказ генератора: код, причина с цифрами, кнопка к разделу. */}
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
                  const code = refusal.code;
                  setRefusal(null);
                  onRefusalClose?.();
                  scrollToSection(code);
                }}
              >
                К настройке
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

      {toast ? <Toast text={toast} /> : null}
    </div>
  );
}

/**
 * Редактор норм часов — В ГОД (AR-180): под каждым полем видна производная
 * «= N ч/нед», по которой генератор и укладывает. Живёт только в `M-22`.
 */
function LoadSection({
  load,
  setYear,
}: {
  load: { entries: LoadEntry[]; version: number } | null;
  setYear: (bindingId: string, hoursPerYear: number) => void;
}) {
  if (!load) return <Skeletons count={3} kind="row" />;
  if (load.entries.length === 0) {
    return <p className="sch-muted">Привязок педагогов пока нет — нормы появятся вместе с привязками в «Предметах»</p>;
  }
  return (
    <>
      {[...new Map(load.entries.map((e) => [e.teacherId, e.teacherName])).entries()].map(([tid, tname]) => (
        <details className="sch-accordion" key={tid} data-testid="S-40.accordion.teacher" open>
          <summary>{tname}</summary>
          <div>
            {load.entries
              .filter((e) => e.teacherId === tid)
              .map((e) => (
                <div className="sch-hours-row" key={e.bindingId}>
                  <label htmlFor={`h-${e.bindingId}`}>
                    {e.subjectName} · {e.classLabel} класс
                    {e.scope === "group" ? `, группа ${e.groupNos.join(", ")}` : ""}
                    <br />
                    <span className="sch-muted">
                      {e.hoursPerYear > 0 ? `= ${weeklyOfYear(e.hoursPerYear)} ч/нед` : "часов в год"}
                    </span>
                  </label>
                  {/* Шаговые кнопки 44×44 рядом с полем часов (§7) —
                      на мобайле; на десктопе CSS их не рендерит. Шаг — 34
                      (учебный год): минус/плюс двигают на один недельный час. */}
                  <div className="sch-stepper">
                    <Button
                      kind="secondary"
                      className="sch-btn--stepper"
                      aria-label={`${e.subjectName}: меньше часов`}
                      disabled={e.hoursPerYear <= 0}
                      onClick={() => setYear(e.bindingId, Math.max(0, e.hoursPerYear - SCHOOL_YEAR_WEEKS))}
                    >
                      <Icon name="minus" />
                    </Button>
                    <input
                      id={`h-${e.bindingId}`}
                      className="sch-input"
                      data-testid="S-40.input.loadHours"
                      data-binding-id={e.bindingId}
                      inputMode="numeric"
                      value={e.hoursPerYear || ""}
                      onChange={(ev) => setYear(e.bindingId, Number(ev.target.value) || 0)}
                    />
                    <Button
                      kind="secondary"
                      className="sch-btn--stepper"
                      aria-label={`${e.subjectName}: больше часов`}
                      onClick={() => setYear(e.bindingId, e.hoursPerYear + SCHOOL_YEAR_WEEKS)}
                    >
                      <Icon name="plus" />
                    </Button>
                  </div>
                </div>
              ))}
            <p className="sch-muted" data-testid="S-40.summary.teacher">
              {tname}: {load.entries.filter((e) => e.teacherId === tid).reduce((a, e) => a + e.hoursPerYear, 0)} ч/год ·{" "}
              {load.entries.filter((e) => e.teacherId === tid).reduce((a, e) => a + weeklyOfYear(e.hoursPerYear), 0)} ч/нед
            </p>
          </div>
        </details>
      ))}
    </>
  );
}

/**
 * `M-22` — нормы часов (AR-174, AR-180): годовые нормы по предмету и ничего
 * больше. Вводится ГОД («Словесность — 340 часов в год»), недельные часы для
 * генератора — производная. Открывают и завуч, и модератор (право «любое из»,
 * AR-174); сохранение роняет подтверждённую сетку в `stale`.
 */
function LoadHoursModal({ onClose }: { onClose: () => void }) {
  const [load, setLoad] = useState<{ entries: LoadEntry[]; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  useEffect(() => {
    api
      .load()
      .then(setLoad)
      .catch((e) => setError(e instanceof SchoolApiError ? e.message : "Не удалось открыть нагрузку"));
  }, []);

  const setYear = (bindingId: string, hoursPerYear: number) =>
    setLoad((cur) =>
      cur
        ? { ...cur, entries: cur.entries.map((x) => (x.bindingId === bindingId ? { ...x, hoursPerYear: Math.max(0, hoursPerYear) } : x)) }
        : cur,
    );

  return (
    <Modal
      title="Нормы часов — в год"
      width={720}
      onClose={onClose}
      testId="M-22"
      mobile="fullscreen"
      footer={
        <div className="sch-actions">
          <Button
            kind="primary"
            testId="S-40.btn.saveLoad"
            disabled={!load || load.entries.length === 0 || load.entries.some((e) => !e.hoursPerYear)}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const fresh = await api.load();
                await api.setLoad({
                  entries: load!.entries.map((e) => ({ bindingId: e.bindingId, hoursPerYear: e.hoursPerYear })),
                  version: fresh.version,
                });
                showToast("Нормы сохранены — сетку пересоберёт модератор");
                onClose();
              } catch (e) {
                setError(e instanceof SchoolApiError ? e.message : "Не получилось");
              } finally {
                setBusy(false);
              }
            }}
          >
            Сохранить
          </Button>
        </div>
      }
    >
      <p className="sch-muted">
        Нормы вводятся часами В ГОД, как в учебном плане. Недельные часы для генератора считаются автоматически: год ÷
        {SCHOOL_YEAR_WEEKS} учебные недели.
      </p>
      <LoadSection load={load} setYear={setYear} />
      {error ? (
        <p className="sch-danger-text" role="alert">
          {error}
        </p>
      ) : null}
      {toast ? <Toast text={toast} /> : null}
    </Modal>
  );
}

/** Первая настройка: `M-08` — одна ПОЛНОЭКРАННАЯ модалка со всеми разделами. */
function ScheduleSetup({
  onClose,
  onGenerated,
  preset,
}: {
  onClose: () => void;
  onGenerated: (p: SchedulePreviewDto) => void;
  preset?: SchedulePreviewDto | null;
}) {
  // Ref, не state: правка любого поля не должна ре-рендерить модалку и
  // переподписывать её Esc-слушатель — Esc, пришедший в щель переподписки,
  // терялся (пойман смоком: M-14 не открылась после правки часов).
  const dirty = useRef(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const close = useCallback(() => (dirty.current ? setConfirmExit(true) : onClose()), [onClose]);

  return (
    <>
      <Modal title="Настройка расписания" width={1080} onClose={close} testId="M-08" mobile="fullscreen">
        <SettingsForm
          onGenerated={onGenerated}
          onDirty={(d) => {
            dirty.current = d;
          }}
          preset={preset}
        />
      </Modal>

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
    </>
  );
}

// ─────────────── S-42 · результат: вкладки «Расписание | Настройка» ───────────────

export function PreviewScreen({ preview, onClose }: { preview: SchedulePreviewDto; onClose: () => void }) {
  const [cur, setCur] = useState(preview);
  const [tab, setTab] = useState<"schedule" | "settings">("schedule");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedSlot | null>(null);
  const { toast, showToast } = useToast();

  /** `S-43`: второй клик по слоту ТОГО ЖЕ класса — перестановка в черновике. */
  const pickCell = async (p: PickedSlot) => {
    if (!picked) {
      setPicked(p);
      return;
    }
    if (picked.classId !== p.classId) {
      setPicked(p); // чужой класс — просто новая точка отсчёта, а не тихий отказ
      showToast("Переставлять можно уроки одного класса — выбран другой урок");
      return;
    }
    if (picked.dayNo === p.dayNo && picked.slotNo === p.slotNo) {
      setPicked(null);
      return;
    }
    setBusy(true);
    try {
      const next = await api.swapSlots({
        templateId: cur.templateId,
        version: cur.version,
        classId: p.classId,
        a: { dayNo: picked.dayNo, slotNo: picked.slotNo },
        b: { dayNo: p.dayNo, slotNo: p.slotNo },
      });
      setCur(next);
      showToast("Уроки переставлены — не забудьте подтвердить сетку");
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
    } finally {
      setBusy(false);
      setPicked(null);
    }
  };

  return (
    <div className="sch-fullscreen sch-studio" data-testid="S-42">
      <header className="sch-tabsbar">
        <button
          className={"sch-studiotab" + (tab === "schedule" ? " sch-studiotab--active" : "")}
          data-testid="S-42.tab.schedule"
          onClick={() => setTab("schedule")}
        >
          Расписание
        </button>
        <button
          className={"sch-studiotab" + (tab === "settings" ? " sch-studiotab--active" : "")}
          data-testid="S-42.tab.settings"
          onClick={() => setTab("settings")}
        >
          Настройка
        </button>
        <span className="sch-topbar-spacer" />
        <Button kind="ghost" testId="S-42.btn.close" aria-label="Закрыть" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </header>

      <div className="sch-studio-body">
        {tab === "schedule" ? (
          <div className="sch-stack">
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
            {cur.status === "draft" ? (
              <p className="sch-muted">
                Ручная правка: выберите урок, затем второй слот того же класса — они поменяются местами
              </p>
            ) : null}
            <WeekGrid
              preview={cur}
              testId="S-42.grid.preview"
              pick={cur.status === "draft" ? { sel: picked, on: pickCell } : undefined}
            />
            {error ? (
              <p className="sch-danger-text" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <SettingsForm preset={cur} onGenerated={(p) => { setCur(p); setTab("schedule"); }} />
        )}
      </div>

      {tab === "schedule" ? (
        <footer className="sch-studio-foot">
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
        </footer>
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </div>
  );
}
