import { useEffect, useState } from "react";
import { Icon } from "@/admin/ds/Icon";
import { Button, Input } from "@/admin/ds/components";
import { WorkHead, Panel } from "@/admin/screens/_shared";
import { structureApi, type StSubject } from "@/lib/structureApi";

const PALETTE = ["#2563EB", "#0EA5A5", "#16A34A", "#D97706", "#DC2626", "#7C5CFC", "#DB2777", "#0D9488"];

// Дисциплины (методист/завуч): создание предметов школы. Реальные данные.
export function DisciplinesScreen() {
  const [subjects, setSubjects] = useState<StSubject[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [loading, setLoading] = useState(true);

  const load = () => structureApi.subjects().then(setSubjects).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    await structureApi.createSubject(name.trim(), color);
    setName("");
    load();
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <WorkHead title="Дисциплины" sub={`${subjects.length} предметов`} />

      <Panel style={{ padding: 18, marginBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1 }}><Input label="Название предмета" value={name} placeholder="напр. Алгебра" onChange={(e) => setName(e.target.value)} /></div>
          <Button variant="create" icon={<Icon name="plus" size={16} />} onClick={add}>Добавить</Button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {PALETTE.map((c) => (
            <button key={c} onClick={() => setColor(c)} title={c}
              style={{ width: 24, height: 24, borderRadius: 7, background: c, border: color === c ? "2px solid var(--text-strong)" : "2px solid transparent", cursor: "pointer" }} />
          ))}
        </div>
      </Panel>

      {loading && <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: 16 }}>Загрузка…</div>}
      {!loading && subjects.length === 0 && <Panel style={{ padding: 24, color: "var(--text-muted)" }}>Предметов пока нет.</Panel>}

      <Panel>
        {subjects.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: s.color, boxShadow: `0 0 0 4px color-mix(in oklch, ${s.color} 16%, transparent)` }} />
              <span style={{ fontWeight: 500, color: "var(--text-strong)" }}>{s.name}</span>
            </div>
            <button onClick={() => structureApi.deleteSubject(s.id).then(load)} className="eds-iconbtn eds-iconbtn--sm eds-iconbtn--danger" title="Удалить"><Icon name="trash-2" size={15} /></button>
          </div>
        ))}
      </Panel>
    </div>
  );
}
