/**
 * `S-82` · настройки и `S-81` · приложение (AR-191).
 *
 * Настройки — дом профиля и переходов: фото (переехало сюда из `M-15`, правка
 * владельца 2026-08-31), разделы «Приложение» и «Устройства». Права здесь не
 * гейт, а правило рендера (AR-69): кнопки фото не рендерятся без
 * `staff.self.write`, сервер всё равно проверит.
 *
 * Приложение — установка PWA на телефон. Две платформы — два маршрута:
 * Android умеет системный диалог (`beforeinstallprompt`), iPhone — только
 * «Поделиться → На экран „Домой“». Экран показывает инструкцию, а не мёртвую
 * кнопку; после установки сессия живёт до удаления приложения (AR-183).
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ROLE_LABELS } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useIsMobile } from "../hooks";
import { Avatar, Badge, Button, LinkRow, Toast, useToast } from "../ui";
import { Icon } from "../icons";
import { useMe, useSession } from "../session";
import { navigate } from "../router";
import { canPromptInstall, isStandalone, onInstallChange, platform, promptInstall } from "../pwa";
import "./settings.css";

/**
 * Версия ПРОДУКТА, а не пакета: `apps/web/package.json` остаётся 0.1.0 внутри
 * монорепо, а человеку в «о приложении» нужен релиз, о котором говорит школа.
 */
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

// ─────────────────────────── S-82 · настройки ───────────────────────────

export function SettingsScreen() {
  const me = useMe();
  const { can, reload } = useSession();
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  /** Отказ сервера — словами в тосте; успех виден по самому фото (§5). */
  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await op();
      await reload();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не удалось сохранить фото");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sch-page-head">
        <h1>Настройки</h1>
      </div>

      <div className="sch-set-stack">
        <section className="sch-card sch-set-profile" data-testid="S-82.profile">
          <Avatar name={me.name} url={me.avatarUrl} large />
          <div className="sch-set-profile-text">
            <span className="sch-card-title">{me.name}</span>
            <span className="sch-muted">{me.roles.map((r) => ROLE_LABELS[r]).join(", ")}</span>
            <span className="sch-muted">{me.schoolName}</span>
          </div>
          {can("staff.self.write") ? (
            <div className="sch-actions sch-actions--start sch-set-actions">
              <Button
                kind="secondary"
                testId="S-82.btn.avatar"
                loading={busy}
                onClick={() => {
                  // Аватар — ссылка, как на `S-04`: файловое хранилище принадлежит
                  // контуру Документохранилища (1.1.2), и тянуть его сюда рано.
                  const value = window.prompt("Ссылка на фото");
                  if (value) void run(() => api.setAvatar(value));
                }}
              >
                Сменить фото
              </Button>
              {me.avatarUrl ? (
                <Button kind="ghost" testId="S-82.btn.avatarClear" disabled={busy} onClick={() => void run(() => api.clearAvatar())}>
                  Удалить фото
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="sch-list--rows" data-testid="S-82.nav">
          <LinkRow icon="phone" label="Приложение" hint="установить на телефон" onClick={() => navigate("/settings/app")} testId="S-82.item.app" />
          <LinkRow icon="monitor" label="Устройства и сессии" onClick={() => navigate("/settings/devices")} testId="S-82.item.devices" />
        </div>

        <p className="sch-muted sch-set-about" data-testid="S-82.about">
          <span>Schoolium {APP_VERSION}</span>
          <br />
          <span>{isStandalone() ? "открыто в приложении" : "открыто в браузере"}</span>
        </p>
      </div>

      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

// ─────────────────────────── S-81 · приложение ───────────────────────────

type Outcome = "accepted" | "dismissed" | null;

export function AppInstallScreen() {
  const mobile = useIsMobile();
  const installed = isStandalone();
  const own = platform();
  const [canPrompt, setCanPrompt] = useState(canPromptInstall);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  // На телефоне шаги своей платформы открыты сразу: человек пришёл ставить,
  // а не читать про вторую платформу. Без диалога Android тоже начинает с шагов.
  const [androidOpen, setAndroidOpen] = useState(() => mobile && own === "android" && !canPromptInstall());
  const [iosOpen, setIosOpen] = useState(() => mobile && own === "ios");

  useEffect(() => onInstallChange(() => setCanPrompt(canPromptInstall())), []);

  const install = async () => {
    setBusy(true);
    const res = await promptInstall().catch(() => null);
    setBusy(false);
    setOutcome(res);
    // Системный диалог показывается один раз на событие: после любого ответа
    // кнопка становится инструкцией, а не повторным «Установить» в никуда.
    setCanPrompt(false);
    if (res !== "accepted") setAndroidOpen(true);
  };

  const android = (
    <section className="sch-card sch-set-card" data-testid="S-81.card.android">
      <div className="sch-set-card-head">
        <span className="sch-set-card-icon">
          <Icon name="android" size={24} />
        </span>
        <span className="sch-card-title">Android</span>
      </div>
      <p className="sch-muted">Сессия хранится до удаления приложения, вход без браузера.</p>
      {installed ? null : canPrompt ? (
        <Button kind="primary" testId="S-81.btn.android" loading={busy} onClick={() => void install()}>
          Установить
        </Button>
      ) : (
        <Button kind="primary" testId="S-81.btn.android" aria-expanded={androidOpen} onClick={() => setAndroidOpen((v) => !v)}>
          Как установить
        </Button>
      )}
      {outcome === "accepted" ? <p className="sch-muted">Приложение устанавливается. Откройте его с главного экрана.</p> : null}
      {outcome === "dismissed" ? <p className="sch-muted">Установка отменена. Ниже — как установить вручную.</p> : null}
      {!installed && androidOpen ? (
        <ol className="sch-set-steps" data-testid="S-81.steps.android">
          <li>Меню браузера (три точки)</li>
          <li>«Установить приложение» или «Добавить на главный экран»</li>
          <li>Установить</li>
        </ol>
      ) : null}
    </section>
  );

  const ios = (
    <section className="sch-card sch-set-card" data-testid="S-81.card.ios">
      <div className="sch-set-card-head">
        <span className="sch-set-card-icon">
          <Icon name="apple" size={24} />
        </span>
        <span className="sch-card-title">iPhone</span>
      </div>
      <p className="sch-muted">Приложение открывается с экрана «Домой», вход сохраняется между запусками.</p>
      {installed ? null : (
        <Button kind="secondary" testId="S-81.btn.ios" aria-expanded={iosOpen} onClick={() => setIosOpen((v) => !v)}>
          Как установить
        </Button>
      )}
      {!installed && iosOpen ? (
        <ol className="sch-set-steps" data-testid="S-81.steps.ios">
          <li>Safari</li>
          <li>Кнопка «Поделиться»</li>
          <li>«На экран „Домой“»</li>
          <li>Добавить</li>
        </ol>
      ) : null}
    </section>
  );

  return (
    <>
      <div className="sch-page-head sch-set-head">
        <h1>Приложение</h1>
        <div className="sch-set-status" data-testid="S-81.status">
          {installed ? <Badge tone="success">Открыто в приложении</Badge> : <Badge tone="muted">Открыто в браузере</Badge>}
          {installed ? <span className="sch-muted">Установка не нужна: приложение уже на этом устройстве.</span> : null}
        </div>
      </div>

      <div className="sch-set-stack">
        {/* На телефоне карточка своей платформы первой (75-adaptive §6). */}
        <div className="sch-set-cards">
          {mobile && own === "ios" ? (
            <>
              {ios}
              {android}
            </>
          ) : (
            <>
              {android}
              {ios}
            </>
          )}
        </div>

        {mobile ? null : (
          <div className="sch-qr sch-set-qr" data-testid="S-81.qr">
            <div className="sch-qr-frame">
              <QRCodeSVG value={`${window.location.origin}/settings/app`} size={200} />
            </div>
            <span className="sch-muted">Откройте на телефоне</span>
          </div>
        )}

        <p className="sch-muted sch-set-about" data-testid="S-81.hint">
          После установки вход сохраняется до удаления приложения
        </p>
      </div>
    </>
  );
}
