import { useEffect, useState } from "react";
import { Icon } from "../ds/Icon";
import { Button } from "../ds/components";
import { WorkHead, Panel } from "./_shared";
import { structureApi, type StDevice } from "@/lib/structureApi";

// Сеть устройств — РЕАЛЬНЫЕ привязанные киоски из таблицы Device (привязка — на самом
// устройстве через QR, см. главную, режим 2). Никаких мок-данных и фейкового онлайна.
export function DevicesScreen() {
  const [devices, setDevices] = useState<StDevice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    structureApi.devices().then(setDevices).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <WorkHead title="Сеть устройств" sub={`${devices.length} привязано`} />

      <Panel style={{ padding: 18, marginBottom: 16, display: "flex", gap: 14, alignItems: "center" }}>
        <span style={{ width: 44, height: 44, borderRadius: 13, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", background: "color-mix(in oklch, var(--accent) 14%, var(--surface-card))" }}>
          <Icon name="qr-code" size={22} />
        </span>
        <div>
          <h3 style={{ marginBottom: 4 }}>Привязка — с самого устройства</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            На школьном компьютере откройте <b>edustore-flor-group.ru</b> и нажмите <b>Ctrl+X+R+T+J</b> —
            появится QR. Отсканируйте его телефоном из этого кабинета — устройство появится здесь.
          </p>
        </div>
      </Panel>

      {loading && <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: 16 }}>Загрузка…</div>}
      {!loading && devices.length === 0 && (
        <Panel style={{ padding: 24, color: "var(--text-muted)" }}>Привязанных устройств пока нет.</Panel>
      )}

      {devices.length > 0 && (
        <div className="adm-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {devices.map((d) => (
            <Panel key={d.id} style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <span style={{ width: 44, height: 44, borderRadius: 13, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563EB", background: "color-mix(in oklch, #2563EB 14%, var(--surface-card))" }}>
                  <Icon name="monitor" size={22} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--text-strong)", fontSize: "var(--text-md)" }}>{d.name}</div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                    {d.boundBy ? `привязал: ${d.boundBy}` : "привязано устройством"}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                  с {new Date(d.boundAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
                <Button variant="ghost" size="sm" icon={<Icon name="link-2-off" size={15} />} onClick={() => structureApi.deleteDevice(d.id).then(load)}>
                  Отвязать
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
