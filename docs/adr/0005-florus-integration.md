# ADR 0005 — Интеграция с Флёрус (identity)

**Статус:** принято · **Дата:** 2026-06 · домен EduStore: `edustore-flor-group.ru`

## Контекст
Флёрус (`accounts.flor-group.ru`) — живой OIDC-IdP: discovery, JWKS, authorization_code
+ PKCE (S256), device flow (RFC 8628), refresh с ротацией, UserInfo, back-channel logout,
организации и роли (`florus_orgs[]`). EduStore — relying party (RP). Значит вся auth-работа
= **потребление стандартного провайдера**, а не строительство.

## Решение

**Модель — BFF (confidential RP).** NestJS `api` держит `client_secret`, токены и
refresh-ротацию; SPA получает только httpOnly-сессию и токенов не видит. Все эндпоинты —
из discovery (`$FLOR_ISSUER/.well-known/openid-configuration`), пути не хардкодим.

**Подтверждённые решения:**
1. **`isFirstParty: true`** — EduStore продукт Flōr Group, без экрана согласия.
2. **Роли.** Флёрус несёт `owner | admin | teacher | staff | parent | student`.
   `staff` EduStore **маппит локально** → `{завуч, методист, психолог}` через permissions;
   конкретную sub-роль внутри staff назначает **школьный админ**. Хранится в EduStore:
   `Membership(florusUserId, orgId, florusRole, subRole)`.
3. **Провижининг орг.** При оплате backend EduStore делает `POST /api/orgs` →
   организация создаётся в Флёрусе со статусом «ожидает активации».

**Ключи и тенант.** `sub` = `florus_user_id` = `User.id` (схема уже совпадает).
Тенант = Флёрус `org_id` → `Organization.florusOrgId`.

**Онбординг устройств/сотрудников** = device flow (RFC 8628), `purpose=provision`.
**Устройства не дублируем** — читаем из Флёруса `GET /api/orgs/devices?orgId` (источник истины).
**Back-channel logout** — ресивер обязателен (kill локальных сессий по `sid`/`sub`).

**Роутинг кабинета:**
```ts
function resolveCabinet(florusRole, subRole) {
  if (florusRole === "staff") return subRole ?? "methodist"; // завуч | методист | психолог
  return florusRole; // owner | admin | teacher | parent | student
}
// роль читается из florus_orgs[].find(o => o.org_id === activeOrg).role; никогда не с клиента
```

## Эндпоинты RP (EduStore)
`/api/auth/flor/login` · `/callback` · `/device/start` · `/device/poll` · `/logout` ·
`/backchannel-logout`. Guard `FlorAuthGuard` кладёт в request `{ florusUserId, orgId, role, subRole }`.

## Env
```
FLOR_ISSUER=https://accounts.flor-group.ru
FLOR_CLIENT_ID=edustore
FLOR_CLIENT_SECRET=…                         # server-only
FLOR_REDIRECT_URI=https://edustore-flor-group.ru/api/auth/flor/callback
FLOR_POST_LOGOUT_REDIRECT_URI=https://edustore-flor-group.ru
FLOR_SCOPES="openid profile phone flor:org flor:roles offline_access"
# backchannel: https://edustore-flor-group.ru/api/auth/flor/backchannel-logout
```

## Регистрация клиента (operator-side, нужен `FLORUS_ADMIN_API_KEY`)
```jsonc
{
  "clientId": "edustore", "clientName": "EduStore", "clientType": "confidential",
  "isFirstParty": true,
  "redirectUris": ["https://edustore-flor-group.ru/api/auth/flor/callback"],
  "postLogoutRedirectUris": ["https://edustore-flor-group.ru"],
  "scopes": ["openid","profile","phone","flor:org","flor:roles","offline_access"],
  "grantTypes": ["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:device_code"],
  "backchannelLogoutUri": "https://edustore-flor-group.ru/api/auth/flor/backchannel-logout"
}
```

## Последствия
+ Identity/онбординг/роли = потребление, не стройка; SSO бесплатно (cookie `.flor-group.ru`);
  QR-онбординг реальный (device flow); админ-«Сеть устройств» получает живой источник.
− Нужны: зарегистрированный клиент + `FLOR_CLIENT_SECRET`; локальная модель `Membership/subRole`;
  OIDC-модуль в `api` (заменяет `DevAuthGuard`, с dev-bypass за env-флагом для локальных прогонов).
