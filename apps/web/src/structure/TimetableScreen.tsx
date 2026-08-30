import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@/admin/ds/components";
import { WorkHead, Panel } from "@/admin/screens/_shared";
import { structureApi, type StClass } from "@/lib/structureApi";
import { eduApi, type TimetableDto } from "@/lib/eduApi";

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]; // 1..6 (вс в типовой неделе не используется)
const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Сетка расписания (AR-38, завуч): типовая неделя класса — клетка (день × позиция) = слот урока.
 * Завуч кликами включает слоты и сохраняет; Solver раскладывает темы КТП по этой сетке.
 * Будущее CP-SAT-авторасписание заполнит ту же сетку — экран не изменится.
 */
export function TimetableScreen() {
  const [classes, setClasses] = useState<StClass[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [current, setCurrent] = useState<TimetableDto | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // "day:position"
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    structureApi.classes().then((cs) => {
      setClasses(cs);
      if (cs.length && !classId) setClassId(cs[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!classId) return;
    setStatus("");
    eduApi.timetable(classId).then((ts) => {
      const t = ts[0] ?? null;
      setCurrent(t);
      setPicked(new Set((t?.slots ?? []).map((s) => `${s.day}:${s.position}`)));
    }).catch(() => {});
  }, [classId]);

  const toggle = (day: number, position: number) => {
    const key = `${day}:${position}`;
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const dirty = useMemo(() => {
    const existing = new Set((current?.slots ?? []).map((s) => `${s.day}:${s.position}`));
    if (existing.size !== picked.size) return true;
    for (const k of picked) if (!existing.has(k)) return true;
    return false;
  }, [current, picked]);

  const save = async () => {
    if (!classId) return;
    setSaving(true);
    setStatus("");
    try {
      const slots = [...picked].map((k) => {
        const [day, position] = k.split(":").map(Number);
        return { day, position };
      });
      const t = await eduApi.saveTimetable(classId, slots);
      setCurrent(t);
      setStatus(`Сохранено: ${t.slots.length} слотов в неделе`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setStatus(
        code === "TIMETABLE_IN_USE"
          ? "Сетка уже держит раскладку КПП — сначала пересоберите или снимите КПП (защита плана)."
          : `Не сохранилось: ${(e as Error).message}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const klass = classes.find((c) => c.id === classId);

  return (
    <div style={{ maxWidth: 860 }}>
      <WorkHead
        title="Сетка расписания"
        sub={klass ? `${klass.label} — типовая неделя, ${picked.size} слотов` : "выберите класс"}
      />

      <Panel style={{ padding: 18, marginBottom: 16, display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ width: 220 }}>
          <Select label="Класс" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </div>
        <Button variant="create" disabled={!dirty || saving} onClick={save}>
          {saving ? "Сохраняю…" : "Сохранить сетку"}
        </Button>
        {status && <div style={{ fontSize: 13, color: "var(--text-soft)", alignSelf: "center" }}>{status}</div>}
      </Panel>

      <Panel style={{ padding: 18, overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 6 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 12, color: "var(--text-soft)", fontWeight: 500, textAlign: "left" }}>Урок</th>
              {DAYS.map((d) => (
                <th key={d} style={{ fontSize: 12, color: "var(--text-soft)", fontWeight: 500, minWidth: 64 }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POSITIONS.map((pos) => (
              <tr key={pos}>
                <td style={{ fontSize: 13, color: "var(--text-soft)", paddingRight: 8 }}>{pos}</td>
                {DAYS.map((_, i) => {
                  const day = i + 1;
                  const on = picked.has(`${day}:${pos}`);
                  return (
                    <td key={day}>
                      <button
                        onClick={() => toggle(day, pos)}
                        title={`${DAYS[i]}, ${pos}-й урок`}
                        style={{
                          width: 64,
                          height: 36,
                          borderRadius: 9,
                          cursor: "pointer",
                          border: on ? "1.5px solid var(--accent, #0EA5A5)" : "1.5px dashed var(--line, #d5d9e0)",
                          background: on ? "var(--accent-soft, rgba(14,165,165,.14))" : "transparent",
                          color: on ? "var(--accent, #0EA5A5)" : "var(--text-soft)",
                          fontSize: 12,
                        }}
                      >
                        {on ? "урок" : "—"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-soft)" }}>
          Слот = место урока в типовой неделе. Solver раскладывает темы утверждённого КТП по этим
          слотам; при нехватке слотов утверждение КПП вернёт «недостаточно слотов».
        </div>
      </Panel>
    </div>
  );
}
