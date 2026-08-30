import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/admin/ds/Icon";
import { Button, Badge } from "@/admin/ds/components";
import { WorkHead, Panel } from "@/admin/screens/_shared";
import { structureApi, type StClass, type StSubject } from "@/lib/structureApi";
import { eduApi, type KtpDto, type KtpTopicDto, type KppDto } from "@/lib/eduApi";
import { HttpError } from "@/lib/http";

/**
 * Надзор завуча над пайплайном планирования (§7): утверждение КТП → Solver раскладывает КПП →
 * утверждение КПП → уроки разблокированы. Движок ПРЕДЛАГАЕТ (Solver), завуч РЕШАЕТ (approve).
 */
export function KtpApprovalScreen() {
  const [ktps, setKtps] = useState<KtpDto[] | null>(null);
  const [kpps, setKpps] = useState<KppDto[]>([]);
  const [classes, setClasses] = useState<StClass[]>([]);
  const [subjects, setSubjects] = useState<StSubject[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openKtpId, setOpenKtpId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    eduApi.ktpList().then(setKtps).catch(() => setKtps([]));
    eduApi.kppList().then(setKpps).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    structureApi.classes().then(setClasses).catch(() => {});
    structureApi.subjects().then(setSubjects).catch(() => {});
  }, [refresh]);

  const cls = useMemo(() => new Map(classes.map((c) => [c.id, c.label])), [classes]);
  const subj = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const title = (classId: string, disciplineId: string) =>
    `${cls.get(classId) ?? "класс"} · ${subj.get(disciplineId) ?? "дисциплина"}`;

  const approveKtp = async (k: KtpDto) => {
    setBusyId(k.id);
    setNote(null);
    try {
      const res = await eduApi.approveKtp(k.id);
      setNote({
        kind: "ok",
        text: res.kpp
          ? `КТП утверждён. Solver собрал КПП: ${res.kpp.lessonCount} уроков — проверьте и утвердите ниже.`
          : `КТП утверждён, но КПП не собрался: ${reasonText(res.reason)}`,
      });
      refresh();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof HttpError ? humanErr(e) : "Не удалось утвердить КТП" });
    } finally {
      setBusyId(null);
    }
  };

  const approveKpp = async (k: KppDto) => {
    setBusyId(k.id);
    setNote(null);
    try {
      await eduApi.approveKpp(k.id);
      setNote({ kind: "ok", text: "КПП утверждён — уроки разблокированы для проведения." });
      refresh();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof HttpError ? humanErr(e) : "Не удалось утвердить КПП" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <WorkHead title="КТП и КПП" sub="утверждение планов: система предлагает — завуч решает" />

      {note && (
        <Panel
          style={{
            padding: "12px 16px",
            marginBottom: 14,
            fontSize: "var(--text-sm)",
            color: note.kind === "ok" ? "var(--text-strong)" : "#DC2626",
            borderLeft: `3px solid ${note.kind === "ok" ? "#16A34A" : "#DC2626"}`,
          }}
        >
          {note.text}
        </Panel>
      )}

      {/* КТП */}
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-muted)", margin: "4px 2px 8px" }}>
        Календарно-тематические планы
      </div>
      {ktps === null && <Panel style={{ padding: 18, color: "var(--text-muted)" }}>Загружаем…</Panel>}
      {ktps !== null && ktps.length === 0 && <Panel style={{ padding: 18, color: "var(--text-muted)" }}>КТП пока нет.</Panel>}
      {(ktps ?? []).map((k) => {
        const hours = k.topics.reduce((s, t) => s + t.fgosHours, 0);
        const estimated = k.topics.filter((t) => t.hoursSource === "estimated").length;
        const isOpen = openKtpId === k.id;
        return (
          <Panel key={k.id} style={{ padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }} onClick={() => setOpenKtpId(isOpen ? null : k.id)}>
              <span style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in oklch, #0EA5A5 14%, transparent)", color: "#0EA5A5", flexShrink: 0 }}>
                <Icon name="file-text" size={20} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{title(k.classId, k.disciplineId)}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>
                  {k.topics.length} тем · {hours} часов ФГОС
                  {estimated > 0 ? ` · ${estimated} — оценка парсера` : ""}
                  {k.approvedBy ? ` · утвердил: ${k.approvedBy}` : ""}
                </div>
              </div>
              {k.status === "approved" ? (
                <Badge tone="create">утверждён</Badge>
              ) : (
                <>
                  <Badge>черновик</Badge>
                  <Button
                    variant="create"
                    icon={<Icon name="circle-check" size={15} />}
                    onClick={(e) => { e.stopPropagation(); void approveKtp(k); }}
                    disabled={busyId === k.id}
                  >
                    {busyId === k.id ? "Утверждаем…" : "Утвердить"}
                  </Button>
                </>
              )}
            </div>
            {isOpen && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 10 }} data-testid="ktp-topics">
                {k.topics
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((t) => (
                    <TopicRow key={t.id} topic={t} editable={k.status === "draft"} onSaved={refresh} />
                  ))}
                {k.topics.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Тем пока нет.</div>}
              </div>
            )}
          </Panel>
        );
      })}

      {/* КПП */}
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-muted)", margin: "18px 2px 8px" }}>
        Поурочные планы (Solver)
      </div>
      {kpps.length === 0 && <Panel style={{ padding: 18, color: "var(--text-muted)" }}>КПП появятся после утверждения КТП.</Panel>}
      {kpps.map((k) => (
        <Panel key={k.id} style={{ padding: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in oklch, #2563EB 13%, transparent)", color: "#2563EB", flexShrink: 0 }}>
            <Icon name="calendar-days" size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{title(k.classId, k.disciplineId)}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>
              {k.lessons.length} уроков · {k.lessons[0] ? `«${k.lessons[0].topic.title}» → …` : "пусто"}
            </div>
          </div>
          {k.status === "approved" ? (
            <Badge tone="create">утверждён</Badge>
          ) : (
            <>
              <Badge tone="accent">на утверждении</Badge>
              <Button variant="create" icon={<Icon name="circle-check" size={15} />} onClick={() => void approveKpp(k)} disabled={busyId === k.id}>
                {busyId === k.id ? "Утверждаем…" : "Утвердить КПП"}
              </Button>
            </>
          )}
        </Panel>
      ))}
    </div>
  );
}

/**
 * Строка темы черновика: часы с пометкой «оценка парсера» (hoursSource=estimated) и inline-правкой.
 * Ручная правка часов снимает флаг на сервере — завуч видит, чему верить, до утверждения.
 */
function TopicRow({ topic, editable, onSaved }: { topic: KtpTopicDto; editable: boolean; onSaved: () => void }) {
  const [hours, setHours] = useState(String(topic.fgosHours));
  const [saving, setSaving] = useState(false);
  useEffect(() => setHours(String(topic.fgosHours)), [topic.fgosHours]);

  const save = async () => {
    const n = Number(hours);
    if (!Number.isInteger(n) || n < 1 || n === topic.fgosHours) {
      setHours(String(topic.fgosHours));
      return;
    }
    setSaving(true);
    try {
      await eduApi.updateKtpTopic(topic.id, { fgosHours: n });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 2px", fontSize: "var(--text-sm)" }} data-testid="ktp-topic-row">
      <span style={{ color: "var(--text-muted)", width: 22, textAlign: "right", flexShrink: 0 }}>{topic.order}.</span>
      <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topic.title}</span>
      {topic.hoursSource === "estimated" && <Badge tone="accent">оценка парсера</Badge>}
      {editable ? (
        <input
          type="number"
          min={1}
          value={hours}
          disabled={saving}
          onChange={(e) => setHours(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          style={{ width: 58, padding: "3px 6px", border: "1px solid var(--border, #d1d5db)", borderRadius: 8, textAlign: "center" }}
          aria-label={`Часы темы «${topic.title}»`}
        />
      ) : (
        <span style={{ width: 58, textAlign: "center" }}>{topic.fgosHours}</span>
      )}
      <span style={{ color: "var(--text-muted)" }}>ч</span>
    </div>
  );
}

function reasonText(code: string | null | undefined): string {
  switch (code) {
    case "INSUFFICIENT_SLOTS":
      return "в сетке Timetable меньше слотов, чем часов КТП — расширьте расписание класса.";
    case "NO_TIMETABLE":
      return "для класса нет сетки Timetable — сначала соберите расписание.";
    case "KPP_IN_USE":
      return "уже есть идущие/проведённые уроки — пересборка заблокирована.";
    case "NO_APPROVED_KTP":
      return "нет утверждённого КТП (обновите страницу).";
    default:
      return code ? `${code}.` : "проверьте сетку Timetable и часы ФГОС.";
  }
}

function humanErr(e: HttpError): string {
  switch (e.code) {
    case "INSUFFICIENT_SLOTS":
      return "Слотов в сетке Timetable меньше, чем часов КТП — расширьте сетку.";
    case "NO_TIMETABLE":
      return "Для класса нет сетки Timetable — сначала соберите расписание.";
    case "KPP_IN_USE":
      return "КПП нельзя пересобрать: есть идущие или проведённые уроки.";
    default:
      return e.message;
  }
}
