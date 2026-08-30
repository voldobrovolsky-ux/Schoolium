import { useCurrentUser, type CurrentUser } from "./CurrentUser";

// DEV-переключатель роли (предпросмотр кабинетов). В проде роль приходит из Флёруса
// (florus_orgs[].role → resolveCabinet), см. ADR-0005 — этот контрол убирается.
const PRESETS: { key: string; label: string; user: CurrentUser }[] = [
  { key: "owner", label: "Учредитель", user: { name: "Виктор Дубровский", florusRole: "owner", subRole: null, orgName: "Flōr Group" } },
  { key: "admin", label: "Школьный админ", user: { name: "Елена Кравцова", florusRole: "admin", subRole: null, orgName: "Гимназия №5" } },
  { key: "zavuch", label: "Завуч", user: { name: "Ольга Минина", florusRole: "staff", subRole: "zavuch", orgName: "Гимназия №5" } },
  { key: "methodist", label: "Методист", user: { name: "Ирина Соловьёва", florusRole: "staff", subRole: "methodist", orgName: "Гимназия №5" } },
  { key: "psychologist", label: "Психолог", user: { name: "Дмитрий Лазарев", florusRole: "staff", subRole: "psychologist", orgName: "Гимназия №5" } },
  { key: "teacher", label: "Учитель", user: { name: "Анна Соколова", florusRole: "teacher", subRole: null, orgName: "Гимназия №5" } },
  { key: "parent", label: "Родитель", user: { name: "Марина Иванова", florusRole: "parent", subRole: null, orgName: "Гимназия №5" } },
  { key: "student", label: "Ученик", user: { name: "Артём Иванов", florusRole: "student", subRole: null, orgName: "Гимназия №5" } },
];

export function RoleSwitch() {
  const { user, setUser } = useCurrentUser();
  const current = PRESETS.find((p) => p.user.florusRole === user.florusRole && p.user.subRole === user.subRole)?.key ?? "teacher";
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 95, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.82)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,.8)", borderRadius: 11, padding: "6px 10px", boxShadow: "0 8px 24px rgba(38,79,140,.18)", fontFamily: "'Golos Text', sans-serif" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#97A1AF", textTransform: "uppercase", letterSpacing: ".04em" }}>роль · dev</span>
      <select
        value={current}
        onChange={(e) => { const p = PRESETS.find((x) => x.key === e.target.value); if (p) setUser(p.user); }}
        style={{ border: "1px solid #D8DEE6", borderRadius: 8, height: 30, padding: "0 8px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "#161B23", background: "#fff", cursor: "pointer" }}
      >
        {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </div>
  );
}
