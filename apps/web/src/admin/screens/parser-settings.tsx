import { useEffect, useState } from "react";
import { Icon } from "../ds/Icon";
import { Button, Badge } from "../ds/components";
import { WorkHead, Panel } from "./_shared";
import { http } from "@/lib/http";

interface SettingsView {
  provider: "regexp" | "llm";
  endpointUrl: string | null;
  modelName: string | null;
  apiKeyMask: string | null; // 'sk-***' если ключ сохранён; сам ключ обратно НЕ приходит
}
interface TestResult {
  ok: boolean;
  topics?: number;
  cards?: number;
  error?: string;
}

const BASE = "/api/v1/admin/parser-settings";

/**
 * Парсер учебников (настройки воркспейса): переключатель провайдера (regexp — встроенный разбор
 * по «Глава/§», дефолт | llm — внешний ИИ-эндпоинт) + endpointUrl/apiKey/modelName для llm.
 * Ключ хранится шифрованным и обратно не отдаётся (только маска). «Проверить соединение» шлёт
 * короткий тестовый текст в настроенный эндпоинт.
 */
export function ParserSettingsScreen() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<"regexp" | "llm">("regexp");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState(""); // пусто = не менять сохранённый
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const load = () =>
    http<SettingsView>(BASE).then((v) => {
      setView(v);
      setProvider(v.provider);
      setEndpointUrl(v.endpointUrl ?? "");
      setModelName(v.modelName ?? "");
      setApiKey("");
    });
  useEffect(() => {
    void load().catch(() => setView({ provider: "regexp", endpointUrl: null, modelName: null, apiKeyMask: null }));
  }, []);

  const save = async () => {
    setSaving(true);
    setSavedNote(false);
    try {
      const body: Record<string, unknown> = { provider, endpointUrl, modelName };
      if (apiKey !== "") body.apiKey = apiKey; // пустое поле = ключ не трогаем
      await http<SettingsView>(BASE, { method: "PUT", body: JSON.stringify(body) });
      await load();
      setSavedNote(true);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await http<TestResult>(`${BASE}/test`, { method: "POST", body: "{}" }));
    } catch (e) {
      setTest({ ok: false, error: e instanceof Error ? e.message : "запрос не прошёл" });
    } finally {
      setTesting(false);
    }
  };

  const field = (label: string, input: React.ReactNode) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      {input}
    </label>
  );
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid var(--border, #d1d5db)",
    borderRadius: 10,
    fontSize: "var(--text-sm)",
    background: "var(--surface-card, #fff)",
    color: "var(--text-strong)",
  };

  if (!view) return <div style={{ color: "var(--text-muted)", padding: 16 }}>Загрузка…</div>;

  return (
    <div style={{ maxWidth: 640 }}>
      <WorkHead title="Парсер учебников" sub="как методкопилка разбирает загруженные учебники на темы и карточки" />

      <Panel style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, color: "var(--text-strong)", marginBottom: 10 }}>Провайдер разбора</div>
        <div style={{ display: "flex", gap: 8 }} data-testid="provider-toggle">
          {(
            [
              ["regexp", "Встроенный (Глава/§)"],
              ["llm", "LLM (внешний ИИ)"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setProvider(k)}
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                border: `1px solid ${provider === k ? "var(--accent, #2563EB)" : "var(--border, #d1d5db)"}`,
                background: provider === k ? "color-mix(in oklch, var(--accent, #2563EB) 12%, transparent)" : "transparent",
                color: "var(--text-strong)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 8 }}>
          Если LLM недоступен (нет ключа, сеть, неверный ответ) — разбор автоматически откатывается на встроенный, загрузка не падает.
        </div>
      </Panel>

      <Panel style={{ padding: 18, marginBottom: 14, opacity: provider === "llm" ? 1 : 0.55 }}>
        <div style={{ fontWeight: 600, color: "var(--text-strong)", marginBottom: 10 }}>Подключение LLM</div>
        {field("URL эндпоинта (OpenAI-совместимый chat/completions)", (
          <input style={inputStyle} value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://api.deepseek.com/v1/chat/completions" data-testid="llm-endpoint" />
        ))}
        {field(`API-ключ${view.apiKeyMask ? ` (сохранён: ${view.apiKeyMask} — введите новый, чтобы заменить)` : ""}`, (
          <input style={inputStyle} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={view.apiKeyMask ?? "sk-…"} data-testid="llm-key" autoComplete="new-password" />
        ))}
        {field("Название модели", (
          <input style={inputStyle} value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="deepseek-chat" data-testid="llm-model" />
        ))}
      </Panel>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Button variant="create" icon={<Icon name="circle-check" size={15} />} onClick={() => void save()} disabled={saving}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
        <Button onClick={() => void runTest()} disabled={testing}>
          {testing ? "Проверяем…" : "Проверить соединение"}
        </Button>
        {savedNote && <Badge tone="create">сохранено</Badge>}
      </div>

      {test && (
        <Panel
          style={{
            padding: "12px 16px",
            marginTop: 14,
            fontSize: "var(--text-sm)",
            borderLeft: `3px solid ${test.ok ? "#16A34A" : "#DC2626"}`,
            color: test.ok ? "var(--text-strong)" : "#DC2626",
          }}
          data-testid="test-result"
        >
          {test.ok
            ? `OK — эндпоинт ответил по контракту (тем: ${test.topics}, карточек: ${test.cards}).`
            : `Ошибка: ${test.error ?? "неизвестно"}`}
        </Panel>
      )}
    </div>
  );
}
