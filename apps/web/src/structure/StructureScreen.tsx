import { useEffect, useState } from "react";
import { Icon } from "@/admin/ds/Icon";
import { Badge, Button, Input, Select } from "@/admin/ds/components";
import { WorkHead, Panel } from "@/admin/screens/_shared";
import { structureApi, type StClass } from "@/lib/structureApi";

// Раздел «Школа» → Структура: классы и подгруппы (онбординг 4.2). Реальные данные.
export function StructureScreen() {
  const [classes, setClasses] = useState<StClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [parallel, setParallel] = useState("5");
  const [letter, setLetter] = useState("А");
  const [busy, setBusy] = useState(false);

  const load = () => structureApi.classes().then(setClasses).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const addClass = async () => {
    if (!letter.trim()) return;
    setBusy(true);
    try { await structureApi.createClass(Number(parallel), letter.trim()); setLetter("А"); await load(); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <WorkHead title="Структура · классы и подгруппы" sub={`${classes.length} классов`} />

      <Panel style={{ padding: 18, marginBottom: 16, display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 130 }}>
          <Select label="Параллель" value={parallel} onChange={(e) => setParallel(e.target.value)}
            options={Array.from({ length: 11 }, (_, i) => String(i + 1))} />
        </div>
        <div style={{ width: 120 }}>
          <Input label="Буква" value={letter} maxLength={8} onChange={(e) => setLetter(e.target.value)} />
        </div>
        <div style={{ alignSelf: "flex-end", color: "var(--text-muted)", fontSize: "var(--text-sm)", paddingBottom: 9 }}>
          → <b style={{ color: "var(--text-strong)" }}>{parallel}{letter.trim().toUpperCase()}</b>
        </div>
        <Button variant="create" icon={<Icon name="plus" size={16} />} onClick={addClass} disabled={busy}>Добавить класс</Button>
      </Panel>

      {loading && <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: 16 }}>Загрузка…</div>}
      {!loading && classes.length === 0 && <Panel style={{ padding: 24, color: "var(--text-muted)" }}>Классов пока нет — создайте первый.</Panel>}

      <div className="adm-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
        {classes.map((c) => (
          <Panel key={c.id} style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 44, height: 44, borderRadius: 13, background: "var(--accent-tint)", color: "var(--accent-press)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 17 }}>{c.label}</span>
                <div>
                  <div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{c.parallel} параллель · «{c.letter}»</div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{c.students} учеников</div>
                </div>
              </div>
              <button onClick={() => structureApi.deleteClass(c.id).then(load)} title="Удалить класс" className="eds-iconbtn eds-iconbtn--sm eds-iconbtn--danger"><Icon name="trash-2" size={15} /></button>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Подгруппы</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {c.subGroups.map((g) => (
                  <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Badge tone="accent">{g.name}</Badge>
                    <button onClick={() => structureApi.deleteSubGroup(g.id).then(load)} className="eds-iconbtn eds-iconbtn--sm" title="Удалить"><Icon name="x" size={13} /></button>
                  </span>
                ))}
                <Button variant="ghost" size="sm" icon={<Icon name="plus" size={14} />}
                  onClick={() => structureApi.addSubGroup(c.id, `${c.subGroups.length + 1} группа`).then(load)}>группа</Button>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
