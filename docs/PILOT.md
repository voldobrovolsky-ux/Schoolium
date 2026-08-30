# Пилотный auth (AUTH_MODE=pilot-qr) — ВРЕМЕННЫЙ

Разовый инструмент для контролируемого запуска (школа «Архимед»), пока не подключён настоящий Флёр
OIDC. **Не Флёр и не dev-bypass `x-florus-*` заголовки** — отдельный, явно помеченный режим. Убрать
при подключении Флёра.

## Поток
```
owner-экран (ключ PILOT_OWNER_KEY):
  «Добавить сотрудника» role=teacher|zavuch → PilotInvite + QR (одноразовый token)
  создать дисциплину/класс (переиспользует StructureService)
  назначить сотрудника → дисциплина/класс (существующая TeachingAssignment)
сотрудник:
  сканирует QR → вводит телефон → POST /api/pilot/login {token, phone}
    → резолв ПО ТОКЕНУ (не по телефону) → создаёт User/Membership/Teacher (при первом входе)
    → Session (cookie flor_sid) ТОЙ ЖЕ формы, что Флёр OIDC
  GET /api/pilot/cabinet-state → «preparing» (не назначен) | «ready» (назначен)
```

## Форма сессии = Флёр OIDC (критично)
Сессия QR-пути пишется в ту же таблицу `Session` и несёт те же claims, что выдаст настоящий Флёр:
`role` + `workspace_id` (+ `subRole`). Маппинг роли — как в `flor.service.provision()`:
`teacher → (florusRole='teacher')`, `zavuch → (florusRole='staff', subRole='zavuch')`. Поэтому
нижестоящий RBAC (`PermissionGuard`/`resolveAccess`) работает одинаково и **не требует спецкейсов**
при подключении Флёра. `AuthGuard` читает cookie `flor_sid` — путь входа ему безразличен.

## Постоянство workspace
«Архимед» создаётся с **постоянным** `florusWorkspaceId = "ws-archimed-pilot"`. Когда подключим
настоящий Флёр, его `workspace_id` claim = тот же id → `provision()` сделает upsert по
`florusWorkspaceId` → **тот же** Workspace, данные (классы/дисциплины/назначения) остаются на месте.

## Осознанные ВРЕМЕННЫЕ трейдоффы пилота (снять при Флёре)
- **Телефон без SMS-подтверждения.** Номер — только идентификация/подпись в системе, **не**
  идентификатор входа (вход резолвится по инвайт-токену). Решение владельца для контролируемого пилота.
- **Owner-экран под `PILOT_OWNER_KEY`** (env), не под доменной ролью: `owner/admin` — tenancy-роли
  Флёра, в токен не приходят (§7.4), поэтому доменного owner-права нет. Гейт fail-closed: ключ не задан
  → 403. Заголовок `x-pilot-owner-key`. Минимальный экран ровно под 3 действия, не полноценная админка.
- **Пилотный `florus_user_id`** генерируется (`pilot-<hex>`) при первом входе. При подключении Флёра
  реальный `sub` будет другим → **сверка идентичности пилот-id ↔ Флёр-sub — отдельный шаг миграции**
  (workspace и структура сохраняются; переигрывать назначения на реальные sub — вручную/скриптом).
- **Режимы разделены жёстко:** `AUTH_MODE=pilot-qr` **выключает** dev-bypass `x-florus-*` (тот — только
  для CI/e2e). В pilot-qr доступ только по реальной сессии (пилотный QR-вход её выдаёт).

## Env
```
AUTH_MODE=pilot-qr          # включает пилотные роуты, выключает x-florus-* bypass
PILOT_OWNER_KEY=<секрет>    # owner-экран (fail-closed без него)
WEB_ORIGIN=…                # для ссылки QR (фронт рендерит QR из token)
```

## Проверка
`npm --workspace apps/api run pilot:check` (16/16): invite → QR-вход → форма сессии = OIDC (role/
workspace_id, RBAC идентичен) → «preparing» → owner назначает → «ready»; teacher и zavuch; постоянство
Архимеда. `tenant:check` 6/6. HTTP-smoke: owner-ключ (403/201), QR-cookie, «preparing», и что
`x-florus-*` bypass в pilot-qr выключен (403 без сессии, 200 с пилотной сессией).
