import { useEffect, useState } from "react";
import { Icon } from "@/admin/ds/Icon";
import { Avatar, Badge, Button, Select } from "@/admin/ds/components";
import { WorkHead, Panel } from "@/admin/screens/_shared";
import { structureApi, type StClass, type StSubject, type StTeacher } from "@/lib/structureApi";

// Распределение учителей (завуч, онбординг §6): учитель слева, предмет + классы справа,
// класс целиком или деление на подгруппы. Реальные данные.
export function DistributionScreen() {
  const [teachers, setTeachers] = useState<StTeacher[]>([]);
  const [classes, setClasses] = useState<StClass[]>([]);
  const [subjects, setSubjects] = useState<StSubject[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([structureApi.teachers(), structureApi.classes(), structureApi.subjects()])
      .then(([t, c, s]) => {
        setTeachers(t); setClasses(c); setSubjects(s);
        setTeacherId((id) => id || t[0]?.id || "");
        setSubjectId((id) => id || s[0]?.id || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const reload = () => structureApi.teachers().then(setTeachers).catch(() => {});
  const teacher = teachers.find((t) => t.id === teacherId);
  const assignmentFor = (classId: string) => teacher?.assignments.find((a) => a.classId === classId && a.subjectId === subjectId);

  const toggle = async (classId: string, on: boolean) => {
    if (on) await structureApi.assign({ teacherId, classId, subjectId });
    else {
      const a = assignmentFor(classId);
      if (a) await structureApi.unassign(a.id);
    }
    reload();
  };
  const setGroup = async (classId: string, subGroupId: string) => {
    await structureApi.assign({ teacherId, classId, subjectId, subGroupId: subGroupId || undefined });
    reload();
  };

  if (loading) return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: 16 }}>Загрузка…</div>;

  return (
    <div>
      <WorkHead title="Распределение учителей" sub="Предмет и классы — целиком или по подгруппам" />
      {teachers.length === 0 ? (
        <Panel style={{ padding: 24, color: "var(--text-muted)" }}>
          Учителя появятся после входа через Флёрус и назначения роли админом.
        </Panel>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) 1fr", gap: 16, alignItems: "start" }}>
          {/* слева — учителя */}
          <Panel style={{ padding: 10 }}>
            {teachers.map((t) => (
              <button key={t.id} onClick={() => setTeacherId(t.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: "none", borderRadius: 10, cursor: "pointer", textAlign: "left", background: t.id === teacherId ? "var(--surface-active)" : "transparent", fontFamily: "var(--font-sans)" }}>
                <Avatar name={t.name} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: t.id === teacherId ? 600 : 500, color: "var(--text-strong)", fontSize: "var(--text-sm)" }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.assignments.length} назначений</div>
                </div>
              </button>
            ))}
          </Panel>

          {/* справа — предмет + классы */}
          <Panel style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <Avatar name={teacher?.name ?? ""} size="md" />
              <div style={{ flex: 1 }}><b style={{ color: "var(--text-strong)" }}>{teacher?.name}</b></div>
              <div style={{ width: 220 }}>
                <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
                  options={subjects.map((s) => ({ value: s.id, label: s.name }))} placeholder="Предмет" />
              </div>
            </div>
            {subjects.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Сначала создайте дисциплины.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {classes.map((c) => {
                const a = assignmentFor(c.id);
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", borderRadius: 10, background: "var(--glass-bg-sunken)" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-strong)", minWidth: 44 }}>{c.label}</span>
                    {a ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {c.subGroups.length > 0 && (
                          <div style={{ width: 150 }}>
                            <Select size="sm" value={a.subGroupId ?? ""} onChange={(e) => setGroup(c.id, e.target.value)}
                              options={[{ value: "", label: "весь класс" }, ...c.subGroups.map((g) => ({ value: g.id, label: g.name }))]} />
                          </div>
                        )}
                        <Badge tone="create" dot>назначен</Badge>
                        <button onClick={() => toggle(c.id, false)} className="eds-iconbtn eds-iconbtn--sm eds-iconbtn--danger" title="Снять"><Icon name="x" size={14} /></button>
                      </div>
                    ) : (
                      <Button variant="secondary" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => toggle(c.id, true)} disabled={!subjectId}>Назначить</Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
